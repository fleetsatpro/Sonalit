/**
 * Portal convoy-data routes.
 *
 * Client (session JWT, §00 enforced on every endpoint):
 *   GET  /portal/convoy/:convoy_id/pod
 *   GET  /portal/convoy/:convoy_id/exceptions
 *   GET  /portal/notifications
 *   PUT  /portal/notifications
 *   GET  /portal/convoy/:convoy_id/documents
 *   GET  /portal/convoy/:convoy_id/sensors
 *   GET  /portal/convoy/:convoy_id/replay
 *
 * Operator (JWT + role):
 *   POST /portal/convoy/:convoy_id/pod
 *   POST /portal/convoy/:convoy_id/documents
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { clientAuth } = require('../middleware/clientAuth');
const { asyncHandler } = require('../middleware/error');
const { query } = require('../config/database');

// §00 guard — returns false and sends 403 if convoy not in client's link set
function checkAccess(client, convoy_id, res) {
  if (!client.convoy_ids.includes(convoy_id)) {
    res.status(403).json({ error: 'Not authorised for this convoy' });
    return false;
  }
  return true;
}

// ── Proof of Delivery ─────────────────────────────────────────────────────────

router.get('/convoy/:convoy_id/pod', clientAuth, asyncHandler(async (req, res) => {
  if (!checkAccess(req.client, req.params.convoy_id, res)) return;
  const { org_id } = req.client;

  const result = await query(
    `SELECT p.id, p.convoy_id, p.shipment_id, p.delivered_at,
            p.recipient_name, p.signature_url, p.photo_urls,
            p.location_lat, p.location_lng, p.notes, p.pod_pdf_url, p.created_at
     FROM proof_of_delivery p
     JOIN convoys c ON c.id = p.convoy_id
    WHERE p.convoy_id = $1 AND c.org_id = $2
    ORDER BY p.delivered_at DESC`,
    [req.params.convoy_id, org_id],
  );

  const data = result.rows.map(r => ({
    id: r.id,
    convoy_id: r.convoy_id,
    shipment_id: r.shipment_id ?? null,
    delivered_at: r.delivered_at,
    recipient_name: r.recipient_name,
    signature_url: r.signature_url ?? null,
    photo_urls: r.photo_urls ?? [],
    location: r.location_lat != null
      ? { lat: parseFloat(r.location_lat), lng: parseFloat(r.location_lng) }
      : null,
    notes: r.notes ?? null,
    pod_pdf_url: r.pod_pdf_url ?? null,
    created_at: r.created_at,
  }));

  res.json({ data });
}));

router.post('/convoy/:convoy_id/pod',
  authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'),
  asyncHandler(async (req, res) => {
    const {
      shipment_id, delivered_at, recipient_name, signature_url,
      photo_urls, location_lat, location_lng, notes, pod_pdf_url,
    } = req.body;
    if (!recipient_name || !delivered_at) {
      return res.status(400).json({ error: 'recipient_name and delivered_at required' });
    }
    const check = await req.db(
      `SELECT id FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [req.params.convoy_id, req.user.org_id],
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Convoy not found' });

    const result = await req.db(
      `INSERT INTO proof_of_delivery
         (org_id, convoy_id, shipment_id, delivered_at, recipient_name,
          signature_url, photo_urls, location_lat, location_lng, notes, pod_pdf_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [req.user.org_id, req.params.convoy_id, shipment_id ?? null, delivered_at,
       recipient_name, signature_url ?? null, photo_urls ?? [],
       location_lat ?? null, location_lng ?? null, notes ?? null, pod_pdf_url ?? null],
    );
    res.status(201).json({ data: result.rows[0] });
  }),
);

// ── Exceptions ────────────────────────────────────────────────────────────────

const ALERT_TYPE_MAP = {
  speed: 'delay', geofence: 'route_deviation',
  mechanical: 'incident', security: 'incident', communication: 'no_signal',
};
const SEVERITY_MAP = { low: 'info', medium: 'warning', high: 'critical', critical: 'critical' };

router.get('/convoy/:convoy_id/exceptions', clientAuth, asyncHandler(async (req, res) => {
  if (!checkAccess(req.client, req.params.convoy_id, res)) return;
  const { org_id } = req.client;

  const result = await query(
    `SELECT a.id, a.type, a.severity, a.message, a.created_at AS occurred_at
     FROM alerts a
     JOIN convoys c ON c.id = a.convoy_id
    WHERE a.convoy_id = $1 AND c.org_id = $2 AND a.deleted_at IS NULL
    ORDER BY a.created_at DESC LIMIT 100`,
    [req.params.convoy_id, org_id],
  );

  const data = result.rows.map(r => ({
    id: r.id,
    convoy_id: req.params.convoy_id,
    type: ALERT_TYPE_MAP[r.type] ?? 'incident',
    severity: SEVERITY_MAP[r.severity] ?? 'info',
    message: r.message,
    occurred_at: r.occurred_at,
  }));

  res.json({ data });
}));

// ── Notification preferences ──────────────────────────────────────────────────

router.get('/notifications', clientAuth, asyncHandler(async (req, res) => {
  const { client_id, org_id } = req.client;
  const result = await query(
    `SELECT convoy_id, events, channels FROM client_notification_prefs
     WHERE client_id = $1 AND org_id = $2`,
    [client_id, org_id],
  );
  res.json({ data: result.rows });
}));

router.put('/notifications', clientAuth, asyncHandler(async (req, res) => {
  const { client_id, org_id } = req.client;
  const { convoy_id, events, channels } = req.body;
  if (!Array.isArray(events) || !Array.isArray(channels)) {
    return res.status(400).json({ error: 'events and channels must be arrays' });
  }
  if (convoy_id && !req.client.convoy_ids.includes(convoy_id)) {
    return res.status(403).json({ error: 'Not authorised for this convoy' });
  }

  // Upsert: for non-null convoy_id use standard conflict clause;
  // for null (global prefs) delete-then-insert to avoid duplicate NULLs
  let row;
  if (convoy_id) {
    const r = await query(
      `INSERT INTO client_notification_prefs (client_id, org_id, convoy_id, events, channels)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (client_id, convoy_id) DO UPDATE SET events = EXCLUDED.events, channels = EXCLUDED.channels
       RETURNING convoy_id, events, channels`,
      [client_id, org_id, convoy_id, events, channels],
    );
    row = r.rows[0];
  } else {
    await query(
      `DELETE FROM client_notification_prefs WHERE client_id = $1 AND org_id = $2 AND convoy_id IS NULL`,
      [client_id, org_id],
    );
    const r = await query(
      `INSERT INTO client_notification_prefs (client_id, org_id, convoy_id, events, channels)
       VALUES ($1,$2,NULL,$3,$4) RETURNING convoy_id, events, channels`,
      [client_id, org_id, events, channels],
    );
    row = r.rows[0];
  }
  res.json({ data: row });
}));

// ── Document vault ────────────────────────────────────────────────────────────

router.get('/convoy/:convoy_id/documents', clientAuth, asyncHandler(async (req, res) => {
  if (!checkAccess(req.client, req.params.convoy_id, res)) return;
  const { org_id } = req.client;

  const result = await query(
    `SELECT d.id, d.convoy_id, d.type, d.label, d.file_url, d.created_at
     FROM portal_documents d
     JOIN convoys c ON c.id = d.convoy_id
    WHERE d.convoy_id = $1 AND c.org_id = $2 AND d.deleted_at IS NULL
    ORDER BY d.created_at DESC`,
    [req.params.convoy_id, org_id],
  );
  res.json({ data: result.rows });
}));

router.post('/convoy/:convoy_id/documents',
  authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'),
  asyncHandler(async (req, res) => {
    const { type, label, file_url } = req.body;
    if (!type || !label || !file_url) {
      return res.status(400).json({ error: 'type, label and file_url required' });
    }
    const check = await req.db(
      `SELECT id FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [req.params.convoy_id, req.user.org_id],
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Convoy not found' });

    const result = await req.db(
      `INSERT INTO portal_documents (org_id, convoy_id, type, label, file_url)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, convoy_id, type, label, file_url, created_at`,
      [req.user.org_id, req.params.convoy_id, type, label, file_url],
    );
    res.status(201).json({ data: result.rows[0] });
  }),
);

// ── Cold-chain sensor telemetry ───────────────────────────────────────────────

router.get('/convoy/:convoy_id/sensors', clientAuth, asyncHandler(async (req, res) => {
  if (!checkAccess(req.client, req.params.convoy_id, res)) return;
  const { org_id } = req.client;
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);

  const result = await query(
    `SELECT sl.vehicle_id, sl.temperature, sl.humidity, sl.shock_g, sl.timestamp
     FROM sensor_logs sl
     JOIN convoy_trucks ct ON ct.vehicle_id = sl.vehicle_id
     JOIN convoys c ON c.id = ct.convoy_id
    WHERE ct.convoy_id = $1 AND c.org_id = $2
      AND sl.timestamp >= NOW() - ($3 || ' hours')::INTERVAL
    ORDER BY sl.timestamp ASC
    LIMIT 2000`,
    [req.params.convoy_id, org_id, hours],
  );

  const readings = result.rows.map(r => ({
    vehicle_id: r.vehicle_id,
    temperature_c: r.temperature != null ? parseFloat(r.temperature) : null,
    humidity_pct: r.humidity != null ? parseFloat(r.humidity) : null,
    shock_g: r.shock_g != null ? parseFloat(r.shock_g) : null,
    recorded_at: r.timestamp,
  }));

  res.json({ data: readings, hours });
}));

// ── Journey replay ────────────────────────────────────────────────────────────

router.get('/convoy/:convoy_id/replay', clientAuth, asyncHandler(async (req, res) => {
  if (!checkAccess(req.client, req.params.convoy_id, res)) return;
  const { org_id } = req.client;

  const result = await query(
    `SELECT g.lat, g.lng, g.timestamp, g.speed, g.vehicle_id
     FROM gps_logs g
     JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
     JOIN convoys c ON c.id = ct.convoy_id
    WHERE ct.convoy_id = $1 AND c.org_id = $2
    ORDER BY g.timestamp ASC
    LIMIT 5000`,
    [req.params.convoy_id, org_id],
  );

  const points = result.rows.map(r => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lng),
    timestamp: r.timestamp,
    speed: r.speed != null ? parseFloat(r.speed) : null,
    vehicle_id: r.vehicle_id,
  }));

  res.json({ data: points });
}));

module.exports = router;
