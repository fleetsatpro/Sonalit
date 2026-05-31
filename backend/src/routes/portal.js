/**
 * Cargo Owner Portal routes.
 *
 * Public (portal token):
 *   GET  /api/v1/portal/convoy           — view convoy status
 *   GET  /api/v1/portal/convoy/custody-pdf — download custody chain PDF
 *
 * Admin (JWT + role):
 *   POST   /api/v1/portal/tokens         — issue token
 *   GET    /api/v1/portal/tokens         — list tokens for a convoy
 *   DELETE /api/v1/portal/tokens/:id     — revoke token
 */
const router = require('express').Router();
const crypto = require('crypto');
const Joi = require('joi');
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { portalAuth } = require('../middleware/portalAuth');
const { generateCustodyPdf } = require('../utils/custodyPdfGenerator');
const jwt = require('jsonwebtoken');
const { asyncHandler } = require('../middleware/error');
const { haversine } = require('../utils/haversine');

// ─── Portal-token-authenticated routes ───────────────────────────────────────

// GET /api/v1/portal/convoy
router.get('/convoy', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const result = await req.db(
    `SELECT
       c.id                                          AS convoy_id,
       c.org_id,
       COALESCE(c.reference, c.name)                AS reference,
       c.status,
       COALESCE(c.origin, c.route_origin)           AS origin,
       COALESCE(c.destination, c.route_destination) AS destination,
       COALESCE(c.departed_at, c.departure_time)    AS departed_at,
       c.arrived_at,
       COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS estimated_arrival_at,
       (SELECT COUNT(*) FROM convoy_trucks ct WHERE ct.convoy_id = c.id) AS vehicle_count,
       (SELECT g.lat  FROM gps_logs g WHERE g.vehicle_id = ANY(
          SELECT ct2.vehicle_id FROM convoy_trucks ct2 WHERE ct2.convoy_id = c.id)
          ORDER BY g.timestamp DESC LIMIT 1) AS last_known_lat,
       (SELECT g.lng  FROM gps_logs g WHERE g.vehicle_id = ANY(
          SELECT ct2.vehicle_id FROM convoy_trucks ct2 WHERE ct2.convoy_id = c.id)
          ORDER BY g.timestamp DESC LIMIT 1) AS last_known_lng,
       (SELECT g.timestamp FROM gps_logs g WHERE g.vehicle_id = ANY(
          SELECT ct2.vehicle_id FROM convoy_trucks ct2 WHERE ct2.convoy_id = c.id)
          ORDER BY g.timestamp DESC LIMIT 1) AS last_location_at,
       c.seal_intact
     FROM convoys c
    WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [convoy_id],
  );

  if (!result.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const row = result.rows[0];
  res.json({
    data: {
      ...row,
      vehicle_count: parseInt(row.vehicle_count) || 0,
      cargo_owner_ref: req.portal.cargo_owner_ref,
    },
  });
}));

// GET /api/v1/portal/convoy/trail
router.get('/convoy/trail', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const result = await req.db(
    `SELECT g.lat, g.lng, g.timestamp AS recorded_at
       FROM gps_logs g
       JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
      WHERE ct.convoy_id = $1
      ORDER BY g.timestamp ASC
      LIMIT 500`,
    [convoy_id],
  );

  res.json({ data: result.rows });
}));

// GET /api/v1/portal/convoy/custody-pdf
router.get('/convoy/custody-pdf', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const convoyResult = await req.db(
    `SELECT
       c.id, c.org_id, c.status, c.seal_intact,
       COALESCE(c.reference, c.name)                AS reference,
       COALESCE(c.origin, c.route_origin)           AS origin,
       COALESCE(c.destination, c.route_destination) AS destination,
       COALESCE(c.departed_at, c.departure_time)    AS departed_at,
       c.arrived_at,
       COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS estimated_arrival_at,
       (SELECT COUNT(*) FROM convoy_trucks ct WHERE ct.convoy_id = c.id) AS vehicle_count
     FROM convoys c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [convoy_id],
  );
  if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const convoy = {
    ...convoyResult.rows[0],
    vehicle_count: parseInt(convoyResult.rows[0].vehicle_count) || 0,
    cargo_owner_ref: req.portal.cargo_owner_ref,
  };

  const posResult = await req.db(
    `SELECT g.lat, g.lng, g.timestamp AS recorded_at, g.speed AS speed_kmh, NULL::TEXT AS source
       FROM gps_logs g
       JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
      WHERE ct.convoy_id = $1
      ORDER BY g.timestamp DESC
      LIMIT 200`,
    [convoy_id],
  );

  const pdfBuffer = await generateCustodyPdf({ convoy, positions: posResult.rows });

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="custody-${convoy.reference}-${Date.now()}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });
  res.end(pdfBuffer);
}));

// ─── Admin routes (JWT) ───────────────────────────────────────────────────────

const issueSchema = Joi.object({
  convoy_id: Joi.string().uuid().required(),
  cargo_owner_ref: Joi.string().max(128).optional(),
  ttl_hours: Joi.number().integer().min(1).max(168).default(24),
});

// POST /api/v1/portal/tokens — issue
router.post('/tokens', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const { error, value } = issueSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const convoyCheck = await req.db(
    `SELECT id FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
    [value.convoy_id],
  );
  if (!convoyCheck.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + value.ttl_hours * 3600 * 1000);

  await req.db(
    `INSERT INTO portal_tokens (org_id, convoy_id, token_hash, cargo_owner_ref, expires_at, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.user.org_id, value.convoy_id, tokenHash, value.cargo_owner_ref ?? null, expiresAt, req.user.id],
  );

  res.status(201).json({
    data: {
      token: rawToken,
      convoy_id: value.convoy_id,
      org_id: req.user.org_id,
      cargo_owner_ref: value.cargo_owner_ref ?? null,
      issued_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    },
  });
}));

// GET /api/v1/portal/tokens?convoy_id=
router.get('/tokens', authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const convoyId = req.query.convoy_id;
  if (!convoyId) return res.status(400).json({ error: 'convoy_id query param required' });
  if (!/^[0-9a-f-]{36}$/i.test(convoyId)) return res.status(400).json({ error: 'convoy_id must be a UUID' });

  const result = await req.db(
    `SELECT pt.id, pt.convoy_id, pt.cargo_owner_ref, pt.issued_at, pt.expires_at,
            pt.last_used_at, pt.revoked_at, u.name AS issued_by_name
       FROM portal_tokens pt
       LEFT JOIN users u ON u.id = pt.issued_by
      WHERE pt.convoy_id = $1
      ORDER BY pt.issued_at DESC`,
    [convoyId],
  );

  res.json({ data: result.rows });
}));

// DELETE /api/v1/portal/tokens/:id — revoke
router.delete('/tokens/:id', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const result = await req.db(
    `UPDATE portal_tokens
        SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id`,
    [req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Token not found or already revoked' });
  res.json({ data: { id: result.rows[0].id, revoked: true } });
}));

// GET /api/v1/portal/convoy/location
router.get('/convoy/location', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const trailResult = await req.db(
    `SELECT g.lat, g.lng, g.timestamp AS t
       FROM gps_logs g
       JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
      WHERE ct.convoy_id = $1
      ORDER BY g.timestamp DESC
      LIMIT 200`,
    [convoy_id],
  );

  const trail = trailResult.rows.slice().reverse(); // ASC by timestamp
  const latest = trail.length ? trail[trail.length - 1] : null;

  let heading = null;
  if (trail.length >= 2) {
    const p1 = trail[trail.length - 2];
    const p2 = trail[trail.length - 1];
    const lat1 = p1.lat * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    heading = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  const corridorResult = await req.db(
    `SELECT route_line FROM convoy_route_corridors
      WHERE convoy_id = $1 AND active = true LIMIT 1`,
    [convoy_id],
  );
  const route_line = corridorResult.rows[0]?.route_line ?? null;
  const origin_coords      = route_line?.length >= 1 ? route_line[0] : null;
  const destination_coords = route_line?.length >= 2 ? route_line[route_line.length - 1] : null;

  res.json({
    data: {
      current_location: latest ? { lat: latest.lat, lng: latest.lng } : null,
      heading: heading !== null ? parseFloat(heading.toFixed(1)) : null,
      speed_kmh: latest ? (parseFloat(latest.speed) || null) : null,
      last_ping_at: latest ? latest.t : null,
      trail: trail.map(r => ({ lat: r.lat, lng: r.lng, t: r.t })),
      route_line,
      origin_coords,
      destination_coords,
    },
  });
}));

// GET /api/v1/portal/convoy/eta
router.get('/convoy/eta', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const convoyResult = await req.db(
    `SELECT c.status, c.arrived_at, c.estimated_arrival_at,
            COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS eta_at
       FROM convoys c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [convoy_id],
  );
  if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const convoy = convoyResult.rows[0];

  if (convoy.status === 'completed' || convoy.arrived_at) {
    return res.json({
      data: {
        eta: convoy.arrived_at ? new Date(convoy.arrived_at).toISOString() : null,
        remaining_km: 0,
        progress_pct: 100,
        status: 'arrived',
        avg_speed_kmh: null,
      },
    });
  }

  const fixResult = await req.db(
    `SELECT g.lat, g.lng, g.speed, g.timestamp
       FROM gps_logs g
       JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
      WHERE ct.convoy_id = $1
      ORDER BY g.timestamp DESC
      LIMIT 200`,
    [convoy_id],
  );

  if (!fixResult.rows.length) {
    return res.json({
      data: { eta: null, remaining_km: null, progress_pct: null, status: 'not_started', avg_speed_kmh: null },
    });
  }

  const latest = fixResult.rows[0];
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const recentSpeeds = fixResult.rows
    .filter(r => new Date(r.timestamp) >= cutoff)
    .map(r => parseFloat(r.speed) || 0);
  const avg_speed_kmh = recentSpeeds.length >= 3
    ? recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length
    : 45;

  const corridorResult = await req.db(
    `SELECT route_line FROM convoy_route_corridors
      WHERE convoy_id = $1 AND active = true LIMIT 1`,
    [convoy_id],
  );
  const routeLine = corridorResult.rows[0]?.route_line ?? null;

  let total_km = null;
  let remaining_km = null;
  let progress_pct = null;

  if (routeLine && routeLine.length >= 2) {
    total_km = 0;
    for (let i = 0; i < routeLine.length - 1; i++) {
      total_km += haversine(routeLine[i].lat, routeLine[i].lng, routeLine[i + 1].lat, routeLine[i + 1].lng);
    }

    // Find closest route point to current location
    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < routeLine.length; i++) {
      const d = haversine(latest.lat, latest.lng, routeLine[i].lat, routeLine[i].lng);
      if (d < minDist) { minDist = d; closestIdx = i; }
    }

    let distance_covered = 0;
    for (let i = 0; i < closestIdx; i++) {
      distance_covered += haversine(routeLine[i].lat, routeLine[i].lng, routeLine[i + 1].lat, routeLine[i + 1].lng);
    }
    remaining_km = Math.max(0, total_km - distance_covered);
    progress_pct = total_km > 0 ? parseFloat(((distance_covered / total_km) * 100).toFixed(1)) : null;
  }

  let eta = null;
  if (remaining_km !== null && avg_speed_kmh > 0) {
    eta = new Date(Date.now() + (remaining_km / avg_speed_kmh) * 3600 * 1000).toISOString();
  }

  let status = 'on_schedule';
  if (!eta) {
    status = 'not_started';
  } else if (convoy.eta_at) {
    const diffMin = (new Date(eta) - new Date(convoy.eta_at)) / 60000;
    if (diffMin > 30) status = 'delayed';
  }

  res.json({
    data: {
      eta,
      remaining_km: remaining_km !== null ? parseFloat(remaining_km.toFixed(2)) : null,
      progress_pct,
      status,
      avg_speed_kmh: parseFloat(avg_speed_kmh.toFixed(1)),
    },
  });
}));

// GET /api/v1/portal/convoy/checkpoints
router.get('/convoy/checkpoints', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const fenceResult = await req.db(
    `SELECT g.id, g.name, g.checkpoint_order
       FROM geofences g
      WHERE g.org_id = (SELECT org_id FROM convoys WHERE id = $1)
        AND g.checkpoint_order IS NOT NULL
      ORDER BY g.checkpoint_order ASC`,
    [convoy_id],
  );

  const checkpoints = await Promise.all(fenceResult.rows.map(async fence => {
    const evResult = await req.db(
      `SELECT created_at FROM geofence_events
        WHERE convoy_id = $1 AND geofence_id = $2 AND event_type = 'checkpoint_signin'
        LIMIT 1`,
      [convoy_id, fence.id],
    );
    const ev = evResult.rows[0] ?? null;
    return {
      name: fence.name,
      order: fence.checkpoint_order,
      reached: !!ev,
      reached_at: ev ? new Date(ev.created_at).toISOString() : null,
    };
  }));

  res.json({ data: checkpoints });
}));

// GET /api/v1/portal/convoy/seals
router.get('/convoy/seals', portalAuth, asyncHandler(async (req, res) => {
  const { convoy_id } = req.portal;

  const convoyResult = await req.db(
    `SELECT seal_intact FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
    [convoy_id],
  );
  if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const { seal_intact } = convoyResult.rows[0];

  const truckResult = await req.db(
    `SELECT id, vehicle_id, position, driver_name, driver_phone
       FROM convoy_trucks WHERE convoy_id = $1 ORDER BY position ASC`,
    [convoy_id],
  );

  let anyUnverified = false;

  const trucks = await Promise.all(truckResult.rows.map(async truck => {
    const photoResult = await req.db(
      `SELECT photo_url, session, photo_type, taken_at
         FROM convoy_truck_photos
        WHERE convoy_id = $1 AND convoy_truck_id = $2 AND photo_type = 'seal'
        ORDER BY taken_at DESC`,
      [convoy_id, truck.id],
    );
    const photos = photoResult.rows;
    const sodCount = photos.filter(p => p.session === 'SOD').length;
    const eodCount = photos.filter(p => p.session === 'EOD').length;
    // unverified if either session has no photos — both SOD and EOD required for 'intact'
    if (sodCount === 0 || eodCount === 0) anyUnverified = true;
    return {
      truck_id: truck.id,
      position: truck.position,
      driver_name: truck.driver_name,
      sod_count: sodCount,
      eod_count: eodCount,
      required: 2,
      photos: photos.slice(0, 3).map(p => ({ url: p.photo_url, type: p.photo_type, session: p.session })),
    };
  }));

  const seal_status = anyUnverified ? 'unverified' : seal_intact === false ? 'compromised' : 'intact';

  res.json({ data: { seal_status, trucks } });
}));

// GET /api/v1/portal/centrifuge-token
router.get('/centrifuge-token', portalAuth, asyncHandler(async (req, res) => {
  const secret = process.env.CENTRIFUGO_TOKEN_HMAC_SECRET;
  if (!secret) return res.status(503).json({ error: 'Realtime not configured' });
  const { convoy_id } = req.portal;
  const cfToken = jwt.sign(
    { sub: `portal:${convoy_id}` },
    secret,
    { expiresIn: '1h', algorithm: 'HS256' },
  );
  res.json({ data: { token: cfToken } });
}));

// Client dashboard + client management (F1)
router.use('/', require('./portalClients'));
// Convoy-data endpoints: POD, exceptions, notifications, documents, sensors, replay (F3–F7)
router.use('/', require('./portalConvoy'));
// Custody ledger: hash-chain events (F8)
router.use('/', require('./portalCustody'));

module.exports = router;
