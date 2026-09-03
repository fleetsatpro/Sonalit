/**
 * Driver-facing tracking endpoints — the only part of Sonalit a driver ever
 * touches, and deliberately the smallest surface in the codebase.
 *
 * A driver scans a QR, grants location access, and drives. There is no
 * dashboard, no map, and no "stop tracking" button: the operational journey
 * owns the lifecycle, so a driver can neither see fleet data nor accidentally
 * end a journey that is still running.
 *
 * Authentication here shares nothing with the operator app — no JWT, no
 * cookies, no CSRF — for the same reason middleware/fieldAuth.js does not:
 * the credential is an opaque, hashed, revocable token, so a QR photographed
 * off a windscreen grants exactly one journey and can be cut off instantly.
 *
 *   Scan/activate : the QR token, in the URL, spent on first use.
 *   Telemetry     : a separate session token in X-Tracking-Session.
 *
 * Splitting the two matters — the QR is a bearer credential that may be
 * photographed, while the session token never leaves the activated device.
 *
 * Tokens are never logged, and responses carry only what the confirmation
 * screen prints (registration, container count, destination). No ids, no
 * customer names, no route detail.
 */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const logger = require('../utils/logger');
const T = require('../utils/trackingEngine');

/** Scans are unauthenticated by nature, so throttle enumeration hard. */
const scanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

/** Telemetry is chatty by design; this only catches runaway clients. */
const pingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limit_exceeded' }),
});

/**
 * Resolve a QR token to its row. Uses the unscoped pool because this IS the
 * authentication step — the org is not known until the token is matched, the
 * same bootstrap fieldAuth performs for a device token. Every query afterwards
 * goes through the org-scoped path.
 */
async function resolveQr(token) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  const result = await query(
    `SELECT * FROM tracking_qr_codes WHERE token_hash = $1 AND deleted_at IS NULL`,
    [T.sha256(token)]
  );
  return result.rows[0] || null;
}

async function resolveSession(req) {
  const token = req.headers['x-tracking-session'];
  if (!token || typeof token !== 'string') return null;
  const result = await query(
    `SELECT * FROM tracking_sessions WHERE session_token_hash = $1 AND deleted_at IS NULL`,
    [T.sha256(token)]
  );
  return result.rows[0] || null;
}

/** Terminal QR states, mapped to what the driver should be told. */
function qrRejection(qr) {
  if (['consumed', 'activated'].includes(qr.status)) {
    return { code: 409, error: 'journey_already_active', message: 'This journey has already been activated.' };
  }
  if (qr.status === 'revoked') {
    return { code: 410, error: 'journey_revoked', message: 'This tracking link has been revoked.' };
  }
  if (['expired', 'cancelled', 'replaced'].includes(qr.status)) {
    return { code: 410, error: 'journey_ended', message: 'This tracking link is no longer active.' };
  }
  if (qr.expires_at && new Date(qr.expires_at) < new Date()) {
    return { code: 410, error: 'journey_ended', message: 'This tracking link is no longer active.' };
  }
  return null;
}

/* ─── Scan ────────────────────────────────────────────────────────────────── */

/**
 * GET /api/v1/track/:token — what the driver's phone loads on scan.
 * Returns only the confirmation-screen fields; anything richer would turn a
 * photographed QR into an intelligence leak.
 */
router.get('/:token', scanLimiter, asyncHandler(async (req, res) => {
  const qr = await resolveQr(req.params.token);
  if (!qr) return res.status(404).json({ error: 'invalid_link', message: 'This tracking link is not valid.' });

  const db = T.dbForOrg(qr.org_id);
  await db(
    `UPDATE tracking_qr_codes SET scan_attempts = scan_attempts + 1, last_scan_attempt_at = NOW() WHERE id = $1`,
    [qr.id]
  ).catch(() => {});

  const rejection = qrRejection(qr);
  if (rejection) {
    await T.recordEvent(db, qr.org_id, {
      qrCodeId: qr.id, eventType: 'QR_SCAN_REJECTED', actorType: 'driver',
      payload: { reason: rejection.error },
    });
    return res.status(rejection.code).json({ error: rejection.error, message: rejection.message });
  }

  if (qr.status !== 'scanned') {
    await db(`UPDATE tracking_qr_codes SET status='scanned', scanned_at=COALESCE(scanned_at, NOW()), updated_at=NOW() WHERE id=$1`, [qr.id]);
    await T.recordEvent(db, qr.org_id, { qrCodeId: qr.id, eventType: 'QR_SCANNED', actorType: 'driver' });
    T.publishTracking(qr.org_id, 'tracking.qr.scanned', {
      qr_id: qr.id, trip_id: qr.trip_id, convoy_id: qr.convoy_id,
    });
  }

  res.json({ data: { journey: qr.display || {}, requires_location: true } });
}));

/* ─── Activate ────────────────────────────────────────────────────────────── */

/**
 * POST /api/v1/track/:token/activate — exchange the QR for a tracking session.
 *
 * The QR is spent here. A second scan cannot mint a second session (the schema
 * enforces one live session per QR); replacing a lost phone is a deliberate
 * Guardian action that issues a fresh QR, not something a driver can do.
 *
 * The session starts in `awaiting_location`, never `active`: permission granted
 * is not the same as GPS working, and Sonalit must not show LIVE until a real
 * fix arrives.
 */
router.post('/:token/activate', scanLimiter, asyncHandler(async (req, res) => {
  const qr = await resolveQr(req.params.token);
  if (!qr) return res.status(404).json({ error: 'invalid_link', message: 'This tracking link is not valid.' });

  const db = T.dbForOrg(qr.org_id);
  const rejection = qrRejection(qr);
  if (rejection) return res.status(rejection.code).json({ error: rejection.error, message: rejection.message });

  const {
    permission_status = 'not_determined',
    background_status = 'unknown',
    location_services_enabled = null,
    gps_available = null,
    failure_reason = null,
    device = {},
    app_version = null,
    platform = null,
  } = req.body || {};

  // Refuse to open a session we know cannot produce telemetry — a half-started
  // journey that shows green is worse than an honest failure.
  if (permission_status !== 'granted') {
    await T.recordEvent(db, qr.org_id, {
      qrCodeId: qr.id, eventType: 'TRACKING_PERMISSION_DENIED', actorType: 'driver',
      payload: { permission_status, failure_reason },
    });
    T.publishTracking(qr.org_id, 'tracking.permission.denied', {
      qr_id: qr.id, trip_id: qr.trip_id, convoy_id: qr.convoy_id, permission_status,
    });
    return res.status(422).json({
      error: 'location_permission_required',
      message: 'Location access is required to activate tracking.',
    });
  }

  const sessionToken = T.newToken();
  const fingerprint = T.deviceFingerprint({ ...device, platform, app_version });

  let session;
  try {
    const inserted = await db(
      `INSERT INTO tracking_sessions
         (org_id, qr_code_id, session_token_hash, status, termination_policy, termination_container_id,
          trip_id, booking_id, convoy_id, vehicle_id, cds_vehicle_id, driver_id, core_driver_id,
          device_fingerprint, device_label, app_version, platform,
          permission_status, background_status, location_services_enabled, gps_available,
          capability_verified_at, capability_failure_reason, last_seen_at)
       VALUES ($1,$2,$3,'awaiting_location',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW(),$21,NOW())
       RETURNING *`,
      [qr.org_id, qr.id, T.sha256(sessionToken), qr.termination_policy, qr.termination_container_id,
       qr.trip_id, qr.booking_id, qr.convoy_id, qr.vehicle_id, qr.cds_vehicle_id, qr.driver_id, qr.core_driver_id,
       fingerprint, device.label || null, app_version, platform,
       permission_status, background_status, location_services_enabled, gps_available, failure_reason]
    );
    session = inserted.rows[0];
  } catch (err) {
    // The partial unique index fired: this QR already has a live session.
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'journey_already_active',
        message: 'This journey has already been activated on another device.',
      });
    }
    throw err;
  }

  // Carry the container set over so multi-container completion rules can be
  // evaluated without re-deriving the load later.
  if (qr.trip_id) {
    await db(
      `INSERT INTO tracking_session_containers (org_id, session_id, container_id, container_number)
       SELECT $1, $2, c.id, c.number
         FROM cds_trips t JOIN cds_containers c ON c.id = t.container_id
        WHERE t.id = $3 AND t.container_id IS NOT NULL
       ON CONFLICT (session_id, container_id) DO NOTHING`,
      [qr.org_id, session.id, qr.trip_id]
    ).catch(err => logger.warn(`tracking: container link failed — ${err.message}`));
  }

  await db(
    `UPDATE tracking_qr_codes SET status='activated', activated_at=NOW(), updated_at=NOW() WHERE id=$1`,
    [qr.id]
  );

  await T.recordEvent(db, qr.org_id, {
    sessionId: session.id, qrCodeId: qr.id, eventType: 'TRACKING_STARTED', actorType: 'driver',
    payload: { background_status, platform },
  });

  T.publishTracking(qr.org_id, 'tracking.session.started', {
    session_id: session.id, qr_id: qr.id, trip_id: qr.trip_id, convoy_id: qr.convoy_id,
    vehicle_id: qr.vehicle_id, health: 'not_started',
  });

  // `background_ok:false` lets the page warn honestly instead of claiming a
  // reliability it cannot deliver.
  res.status(201).json({
    data: {
      session_token: sessionToken,
      journey: qr.display || {},
      background_ok: background_status === 'granted',
      ping_interval_seconds: 15,
    },
  });
}));

/* ─── Telemetry ───────────────────────────────────────────────────────────── */

/**
 * POST /api/v1/track/session/ping — accept one or many fixes.
 *
 * Batches exist because the phone buffers while offline; each point keeps its
 * original `device_time`, and points that waited are marked `buffered` so the
 * command centre never mistakes a replayed fix for a live one.
 */
router.post('/session/ping', pingLimiter, asyncHandler(async (req, res) => {
  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'invalid_session' });

  const db = T.dbForOrg(session.org_id);

  // Journey over — tell the device to stop. This is how a driver's phone stops
  // tracking without the driver ever pressing anything.
  if (!T.LIVE_STATUSES.includes(session.status)) {
    return res.json({ data: { terminated: true, status: session.status, reason: session.termination_reason } });
  }

  const body = req.body || {};
  const fixes = Array.isArray(body.locations) ? body.locations : (body.location ? [body.location] : []);
  if (!fixes.length) return res.status(400).json({ error: 'no_locations' });

  const previous = await db(
    `SELECT lat, lng, device_time FROM tracking_locations
      WHERE session_id = $1 AND quality <> 'rejected' ORDER BY device_time DESC LIMIT 1`,
    [session.id]
  );
  let prev = previous.rows[0] || null;

  const now = Date.now();
  let accepted = 0, anomalies = 0, buffered = 0, canonical = null;

  for (const raw of fixes.slice(0, 200)) {
    const fix = {
      lat: Number(raw.lat), lng: Number(raw.lng),
      accuracy_m: raw.accuracy_m != null ? Number(raw.accuracy_m) : null,
      altitude_m: raw.altitude_m != null ? Number(raw.altitude_m) : null,
      speed_kph: raw.speed_kph != null ? Number(raw.speed_kph) : null,
      heading: raw.heading != null ? Number(raw.heading) : null,
      device_time: raw.device_time || new Date().toISOString(),
      battery_level: raw.battery_level != null ? Math.round(Number(raw.battery_level)) : null,
      network_status: raw.network_status || null,
      buffered: !!raw.buffered,
    };

    const verdict = T.validateFix(prev, fix, now);
    if (verdict.quality !== 'good') anomalies++;
    if (fix.buffered) buffered++;

    try {
      await db(
        `INSERT INTO tracking_locations
           (org_id, session_id, source, lat, lng, accuracy_m, altitude_m, speed_kph, heading,
            device_time, battery_level, network_status, buffered, quality, anomaly_reason)
         VALUES ($1,$2,'guardian_gps',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (session_id, source, device_time) DO NOTHING`,
        [session.org_id, session.id, fix.lat, fix.lng, fix.accuracy_m, fix.altitude_m,
         fix.speed_kph, fix.heading, fix.device_time, fix.battery_level, fix.network_status,
         fix.buffered, verdict.quality, verdict.anomaly_reason]
      );
    } catch (err) {
      logger.warn(`tracking: fix rejected — ${err.message}`);
      continue;
    }

    accepted++;
    if (verdict.quality !== 'rejected') {
      prev = { lat: fix.lat, lng: fix.lng, device_time: fix.device_time };
      if (!canonical || new Date(fix.device_time) > new Date(canonical.device_time)) {
        canonical = { ...fix, source: 'guardian_gps', quality: verdict.quality };
      }
    }
  }

  // Fold the newest good fix into the session's canonical position. Reconcile
  // over a single source today; when SecuriSat lands its latest reading joins
  // the candidate list here and nothing else changes.
  if (canonical) {
    const chosen = T.reconcile([canonical], now);
    const ageSec = (now - new Date(chosen.device_time).getTime()) / 1000;
    const confidence = T.computeConfidence({
      accuracyM: chosen.accuracy_m, ageSeconds: ageSec,
      sourceCount: chosen.sourceCount, agreementKm: chosen.agreementKm,
    });

    const wasFirst = !session.first_location_at;
    await db(
      `UPDATE tracking_sessions
          SET status = 'active',
              current_lat = $1, current_lng = $2, current_accuracy_m = $3,
              current_speed_kph = $4, current_heading = $5, current_altitude_m = $6,
              current_source = $7, current_confidence = $8,
              start_lat = COALESCE(start_lat, $1), start_lng = COALESCE(start_lng, $2),
              first_location_at = COALESCE(first_location_at, NOW()),
              last_location_at = NOW(), last_seen_at = NOW(),
              battery_level = COALESCE($9, battery_level),
              network_status = COALESCE($10, network_status),
              location_count = location_count + $11,
              buffered_count = buffered_count + $12,
              anomaly_count = anomaly_count + $13,
              updated_at = NOW()
        WHERE id = $14`,
      [chosen.lat, chosen.lng, chosen.accuracy_m, chosen.speed_kph, chosen.heading, chosen.altitude_m,
       'guardian_gps', confidence, chosen.battery_level, chosen.network_status,
       accepted, buffered, anomalies, session.id]
    );

    if (wasFirst) {
      await T.recordEvent(db, session.org_id, {
        sessionId: session.id, eventType: 'TRACKING_FIRST_LOCATION', actorType: 'driver',
      });
    }

    T.publishTracking(session.org_id, 'tracking.location', {
      session_id: session.id, trip_id: session.trip_id, convoy_id: session.convoy_id,
      vehicle_id: session.vehicle_id, lat: chosen.lat, lng: chosen.lng,
      speed_kph: chosen.speed_kph, heading: chosen.heading,
      source: 'guardian_gps', confidence, health: 'live',
    });
  } else {
    await db(
      `UPDATE tracking_sessions SET last_seen_at = NOW(), anomaly_count = anomaly_count + $1, updated_at = NOW() WHERE id = $2`,
      [anomalies, session.id]
    );
  }

  res.json({ data: { accepted, anomalies, terminated: false, ping_interval_seconds: 15 } });
}));

/**
 * POST /api/v1/track/session/capability — the driver's permission state changed
 * mid-journey (revoked in settings, location services switched off, battery
 * saver kicked in). Recording it is what lets Guardian see "tracking at risk"
 * before the fixes actually stop.
 */
router.post('/session/capability', pingLimiter, asyncHandler(async (req, res) => {
  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'invalid_session' });

  const db = T.dbForOrg(session.org_id);
  const {
    permission_status, background_status,
    location_services_enabled = null, gps_available = null, failure_reason = null,
  } = req.body || {};

  await db(
    `UPDATE tracking_sessions
        SET permission_status = COALESCE($1, permission_status),
            background_status = COALESCE($2, background_status),
            location_services_enabled = $3, gps_available = $4,
            capability_failure_reason = $5, capability_verified_at = NOW(),
            last_seen_at = NOW(), updated_at = NOW()
      WHERE id = $6`,
    [permission_status || null, background_status || null,
     location_services_enabled, gps_available, failure_reason, session.id]
  );

  await T.recordEvent(db, session.org_id, {
    sessionId: session.id, eventType: 'TRACKING_CAPABILITY_CHANGED', actorType: 'driver',
    payload: { permission_status, background_status, location_services_enabled, gps_available, failure_reason },
  });

  if (permission_status && permission_status !== 'granted') {
    T.publishTracking(session.org_id, 'tracking.capability.degraded', {
      session_id: session.id, trip_id: session.trip_id, convoy_id: session.convoy_id,
      permission_status, failure_reason,
    });
  }

  res.json({ data: { ok: true, terminated: !T.LIVE_STATUSES.includes(session.status) } });
}));

/**
 * GET /api/v1/track/session/state — the one poll the driver page makes, purely
 * so it can stop itself when the journey ends. Returns no operational data.
 */
router.get('/session/state', asyncHandler(async (req, res) => {
  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'invalid_session' });
  const terminated = !T.LIVE_STATUSES.includes(session.status);
  res.json({ data: { terminated, status: session.status, ping_interval_seconds: 15 } });
}));

module.exports = router;
