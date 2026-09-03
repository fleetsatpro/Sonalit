/**
 * Hybrid Tracking — operator, Guardian and command-centre surface.
 *
 * The mirror image of routes/trackingDriver.js: the driver sees almost nothing,
 * and everything they cannot see is here. Guardian issues and revokes QRs,
 * watches which vehicles have not started tracking, and can terminate a journey
 * by hand; CDS reads a container's live position and journey timeline.
 *
 * Health is computed on read rather than stored, because "LIVE" is a statement
 * about *now* — a row written five minutes ago cannot know it has gone stale,
 * and a cached flag is exactly how dashboards end up showing a lorry parked in
 * a field it left an hour earlier.
 *
 * Uses dualAuthenticate so the Field app's yard tablets can read back the QR
 * they just generated at the gate, on the same credential they clamp with.
 */
const router = require('express').Router();
const { dualAuthenticate } = require('../middleware/fieldAuth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');
const T = require('../utils/trackingEngine');

router.use(dualAuthenticate, attachOrgDb);
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

/**
 * Decorate a session row with derived, never-stored operational state.
 *
 * `health` (is telemetry arriving) and `capability` (can this runtime keep
 * producing it once the phone locks) are returned as separate fields on
 * purpose. Guardian must never infer capability from a green LIVE dot: a web
 * session can be perfectly LIVE right now and still stop the instant the driver
 * switches apps, and that is a reliability limitation operations needs to see
 * rather than discover.
 */
function decorate(session, now = Date.now()) {
  if (!session) return null;
  const health = T.computeHealth(session, now);
  const ageSec = session.last_location_at
    ? Math.round((now - new Date(session.last_location_at).getTime()) / 1000)
    : null;
  return {
    ...session,
    health,
    // Never present a stale fix as the live one.
    position_is_live: health === 'live',
    last_update_seconds: ageSec,
    sources: session.current_source ? [session.current_source] : [],
    capability: T.capabilityOf(session, health),
  };
}

/* ─── QR management ───────────────────────────────────────────────────────── */

/**
 * POST /api/v1/tracking/qr — Guardian issues a QR for a convoy vehicle.
 *
 * The yard's container QR is minted inside the clamp flow itself (see
 * routes/cds.js) so the gate crew never has to remember a second step; this
 * endpoint is the convoy half, where a CFO is assigning vehicles up front.
 */
router.post('/qr', authorize('admin', 'dispatcher', 'operator', 'cfo'), asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const {
    convoy_id, vehicle_id, cds_vehicle_id, driver_id, core_driver_id, trip_id, booking_id,
    termination_policy, termination_container_id, display, expires_at, replace = true,
  } = req.body || {};

  if (!convoy_id && !trip_id) {
    return res.status(400).json({ error: 'convoy_id or trip_id is required' });
  }

  if (convoy_id) {
    const convoy = await req.db('SELECT id, status FROM convoys WHERE id=$1 AND deleted_at IS NULL', [convoy_id]);
    if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
    // Minting a code for a finished convoy would create a link that is invalid
    // the moment it is printed.
    if (['completed', 'aborted', 'cancelled'].includes(convoy.rows[0].status)) {
      return res.status(409).json({ error: 'convoy_ended', message: 'This convoy has already ended.' });
    }
  }

  if (replace) {
    await T.supersedeOpenQrs(req.db, { tripId: trip_id || null, convoyId: convoy_id || null, vehicleId: vehicle_id || null });
  }

  const { qr, token, url } = await T.issueQr(req.db, orgId, {
    purpose: convoy_id ? 'convoy_vehicle' : 'cds_container',
    terminationPolicy: termination_policy || (convoy_id ? 'convoy_ended' : 'container_delivered'),
    terminationContainerId: termination_container_id || null,
    tripId: trip_id || null, bookingId: booking_id || null, convoyId: convoy_id || null,
    vehicleId: vehicle_id || null, cdsVehicleId: cds_vehicle_id || null,
    driverId: driver_id || null, coreDriverId: core_driver_id || null,
    display: display || {}, issuedBy: req.user.id, expiresAt: expires_at || null,
  });

  await T.recordEvent(req.db, orgId, {
    qrCodeId: qr.id, eventType: 'QR_GENERATED', actorType: 'guardian',
    actorId: req.user.id, actorName: req.user.name || null,
    payload: { purpose: qr.purpose, convoy_id, trip_id },
  });

  T.publishTracking(orgId, 'tracking.qr.generated', {
    qr_id: qr.id, convoy_id: convoy_id || null, trip_id: trip_id || null, vehicle_id: vehicle_id || null,
  });

  // The token is returned here and never again — it exists only to be rendered.
  res.status(201).json({ data: { qr: { ...qr, token_hash: undefined }, token, url } });
}));

/** GET /api/v1/tracking/qr — QR board: who has one, who has scanned it. */
router.get('/qr', asyncHandler(async (req, res) => {
  const filters = [], params = [];
  if (req.query.convoy_id) { params.push(req.query.convoy_id); filters.push(`q.convoy_id=$${params.length}`); }
  if (req.query.trip_id)   { params.push(req.query.trip_id);   filters.push(`q.trip_id=$${params.length}`); }
  if (req.query.status)    { params.push(req.query.status);    filters.push(`q.status=$${params.length}`); }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const result = await req.db(
    `SELECT q.id, q.purpose, q.status, q.termination_policy, q.display,
            q.trip_id, q.booking_id, q.convoy_id, q.vehicle_id, q.cds_vehicle_id,
            q.issued_at, q.scanned_at, q.activated_at, q.consumed_at, q.expires_at,
            q.revoked_at, q.revoke_reason, q.scan_attempts,
            s.id AS session_id, s.status AS session_status, s.last_location_at, s.first_location_at
       FROM tracking_qr_codes q
       LEFT JOIN tracking_sessions s ON s.qr_code_id = q.id AND s.deleted_at IS NULL
      WHERE q.deleted_at IS NULL ${where}
      ORDER BY q.issued_at DESC LIMIT 200`,
    params
  );

  const now = Date.now();
  res.json({
    data: result.rows.map(r => ({
      ...r,
      // What Guardian actually wants to read at a glance.
      tracking_state: r.session_id
        ? T.computeHealth({ status: r.session_status, first_location_at: r.first_location_at, last_location_at: r.last_location_at }, now)
        : (r.status === 'scanned' ? 'scanned_not_activated' : 'qr_not_scanned'),
    })),
  });
}));

/** POST /api/v1/tracking/qr/:id/revoke — kill a code before it is used. */
router.post('/qr/:id/revoke', authorize('admin', 'dispatcher', 'operator', 'cfo'), asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  const result = await req.db(
    `UPDATE tracking_qr_codes
        SET status='revoked', revoked_at=NOW(), revoked_by=$1, revoke_reason=$2, updated_at=NOW()
      WHERE id=$3 AND status IN ('generated','ready','scanned')
      RETURNING *`,
    [req.user.id, reason || null, req.params.id]
  );
  if (!result.rows.length) return res.status(409).json({ error: 'qr_not_revocable' });

  await T.recordEvent(req.db, req.user.org_id, {
    qrCodeId: req.params.id, eventType: 'QR_REVOKED', actorType: 'guardian',
    actorId: req.user.id, actorName: req.user.name || null, payload: { reason: reason || null },
  });

  res.json({ data: { ...result.rows[0], token_hash: undefined } });
}));

/* ─── Sessions ────────────────────────────────────────────────────────────── */

/** GET /api/v1/tracking/sessions — live board, newest movement first. */
router.get('/sessions', asyncHandler(async (req, res) => {
  const filters = [], params = [];
  if (req.query.convoy_id) { params.push(req.query.convoy_id); filters.push(`convoy_id=$${params.length}`); }
  if (req.query.trip_id)   { params.push(req.query.trip_id);   filters.push(`trip_id=$${params.length}`); }
  if (req.query.active === 'true') filters.push(`status = ANY('{${T.LIVE_STATUSES.join(',')}}'::text[])`);
  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const result = await req.db(
    `SELECT * FROM tracking_sessions
      WHERE deleted_at IS NULL ${where}
      ORDER BY COALESCE(last_location_at, started_at) DESC LIMIT 200`,
    params
  );
  const now = Date.now();
  res.json({ data: result.rows.map(s => decorate({ ...s, session_token_hash: undefined }, now)) });
}));

/** GET /api/v1/tracking/sessions/:id */
router.get('/sessions/:id', asyncHandler(async (req, res) => {
  const result = await req.db('SELECT * FROM tracking_sessions WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Session not found' });

  const containers = await req.db(
    'SELECT container_id, container_number, delivered_at FROM tracking_session_containers WHERE session_id=$1',
    [req.params.id]
  );
  res.json({
    data: {
      ...decorate({ ...result.rows[0], session_token_hash: undefined }),
      containers: containers.rows,
    },
  });
}));

/** GET /api/v1/tracking/sessions/:id/locations — the drawn trail. */
router.get('/sessions/:id/locations', asyncHandler(async (req, res) => {
  const limit = Math.min(5000, parseInt(req.query.limit, 10) || 1000);
  const result = await req.db(
    `SELECT lat, lng, accuracy_m, speed_kph, heading, device_time, server_time,
            source, buffered, quality, anomaly_reason
       FROM tracking_locations
      WHERE session_id=$1 AND quality <> 'rejected'
      ORDER BY device_time ASC LIMIT $2`,
    [req.params.id, limit]
  );
  res.json({ data: result.rows });
}));

/**
 * POST /api/v1/tracking/sessions/:id/terminate — the manual override.
 * Reserved for authorised staff and always audited: the normal path is an
 * operational event ending the journey, not a person.
 */
router.post('/sessions/:id/terminate', authorize('admin', 'dispatcher', 'operator', 'cfo'), asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  const session = await T.terminateSession(
    req.db, req.user.org_id, req.params.id,
    reason ? `MANUAL: ${reason}` : 'MANUAL',
    { id: req.user.id, name: req.user.name, type: 'guardian' }
  );
  if (!session) return res.status(404).json({ error: 'Session not found' });

  await T.recordEvent(req.db, req.user.org_id, {
    sessionId: req.params.id, eventType: 'TRACKING_MANUALLY_TERMINATED', actorType: 'guardian',
    actorId: req.user.id, actorName: req.user.name || null, payload: { reason: reason || null },
  });

  res.json({ data: decorate({ ...session, session_token_hash: undefined }) });
}));

/* ─── Operational views ───────────────────────────────────────────────────── */

/**
 * GET /api/v1/tracking/convoys/:id/live — the convoy board from §24:
 * one row per vehicle, including the ones that have not scanned yet, because
 * a missing vehicle is the most operationally interesting row on the screen.
 */
router.get('/convoys/:id/live', asyncHandler(async (req, res) => {
  const sessions = await req.db(
    `SELECT * FROM tracking_sessions WHERE convoy_id=$1 AND deleted_at IS NULL
      ORDER BY COALESCE(last_location_at, started_at) DESC`,
    [req.params.id]
  );
  const pending = await req.db(
    `SELECT q.id AS qr_id, q.status, q.display, q.vehicle_id, q.cds_vehicle_id, q.issued_at, q.scanned_at
       FROM tracking_qr_codes q
      WHERE q.convoy_id=$1 AND q.deleted_at IS NULL
        AND q.status IN ('generated','ready','scanned')`,
    [req.params.id]
  );

  const now = Date.now();
  res.json({
    data: {
      sessions: sessions.rows.map(s => decorate({ ...s, session_token_hash: undefined }, now)),
      awaiting_scan: pending.rows.map(q => ({
        ...q, tracking_state: q.status === 'scanned' ? 'scanned_not_activated' : 'qr_not_scanned',
      })),
    },
  });
}));

/** GET /api/v1/tracking/trips/:id/live — CDS container live position. */
router.get('/trips/:id/live', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT * FROM tracking_sessions WHERE trip_id=$1 AND deleted_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [req.params.id]
  );
  if (!result.rows.length) {
    const qr = await req.db(
      `SELECT id, status, issued_at, scanned_at FROM tracking_qr_codes
        WHERE trip_id=$1 AND deleted_at IS NULL ORDER BY issued_at DESC LIMIT 1`,
      [req.params.id]
    );
    return res.json({
      data: {
        session: null,
        tracking_state: qr.rows.length
          ? (qr.rows[0].status === 'scanned' ? 'scanned_not_activated' : 'qr_not_scanned')
          : 'not_started',
        qr: qr.rows[0] || null,
      },
    });
  }
  const session = decorate({ ...result.rows[0], session_token_hash: undefined });
  res.json({ data: { session, tracking_state: session.health } });
}));

/**
 * GET /api/v1/tracking/trips/:id/timeline — the container journey timeline
 * (§21): clamped → QR generated → scanned → moving → signal lost → delivered.
 */
router.get('/trips/:id/timeline', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT e.event_type, e.actor_type, e.actor_name, e.payload, e.created_at
       FROM tracking_events e
       LEFT JOIN tracking_sessions s ON s.id = e.session_id
       LEFT JOIN tracking_qr_codes q ON q.id = e.qr_code_id
      WHERE s.trip_id = $1 OR q.trip_id = $1
      ORDER BY e.created_at ASC LIMIT 500`,
    [req.params.id]
  );
  res.json({ data: result.rows });
}));

/**
 * GET /api/v1/tracking/sources — the source registry behind the "Tracking
 * Sources" panel. SecuriSat is listed before it is integrated on purpose: the
 * architecture is multi-source from day one, and the UI should say so.
 */
router.get('/sources', asyncHandler(async (req, res) => {
  const counts = await req.db(
    `SELECT current_source AS source, COUNT(*)::int AS sessions
       FROM tracking_sessions
      WHERE status = ANY($1::text[]) AND deleted_at IS NULL AND current_source IS NOT NULL
      GROUP BY current_source`,
    [T.LIVE_STATUSES]
  );
  const bySource = Object.fromEntries(counts.rows.map(r => [r.source, r.sessions]));

  res.json({
    data: [
      { id: 'guardian_gps', label: 'Guardian GPS', integrated: true,
        priority: T.SOURCE_PRIORITY.guardian_gps, active_sessions: bySource.guardian_gps || 0 },
      { id: 'securisat_elock', label: 'SecuriSat E-Lock', integrated: false,
        priority: T.SOURCE_PRIORITY.securisat_elock, active_sessions: bySource.securisat_elock || 0 },
      { id: 'device_telematics', label: 'Telematics', integrated: false,
        priority: T.SOURCE_PRIORITY.device_telematics, active_sessions: bySource.device_telematics || 0 },
    ],
    thresholds: T.thresholds,
  });
}));

module.exports = router;
