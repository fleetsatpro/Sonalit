/**
 * Portal client-facing and client-management routes.
 *
 * Client (session JWT):
 *   GET  /api/v1/portal/shipments          — dashboard: linked convoy summaries
 *
 * Operator (JWT + role):
 *   POST /api/v1/portal/clients            — create / upsert cargo client
 *   POST /api/v1/portal/clients/:id/links  — link client to a convoy
 *   GET  /api/v1/portal/clients            — list clients for the org
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { clientAuth } = require('../middleware/clientAuth');
const { asyncHandler } = require('../middleware/error');
const { query } = require('../config/database');

// GET /api/v1/portal/shipments — client dashboard: all their linked convoys
router.get('/shipments', clientAuth, asyncHandler(async (req, res) => {
  const { org_id, convoy_ids } = req.client;
  if (!convoy_ids.length) return res.json({ data: [] });

  // Build placeholders $2..$N for the convoy_ids IN clause
  // Also fetch per-convoy: last_ping_at, progress_pct (via gps_logs + corridors),
  // exception_count (from geofence_events type=route_deviation + alerts), seal_status

  const placeholders = convoy_ids.map((_, i) => `$${i + 2}`).join(',');

  const result = await query(
    `SELECT
       c.id AS convoy_id,
       COALESCE(c.reference, c.name) AS reference,
       c.status,
       COALESCE(c.origin, c.route_origin) AS origin,
       COALESCE(c.destination, c.route_destination) AS destination,
       COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS eta,
       (SELECT g.timestamp FROM gps_logs g
          JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
         WHERE ct.convoy_id = c.id ORDER BY g.timestamp DESC LIMIT 1) AS last_ping_at,
       (SELECT g.lat FROM gps_logs g
          JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
         WHERE ct.convoy_id = c.id ORDER BY g.timestamp DESC LIMIT 1) AS current_lat,
       (SELECT g.lng FROM gps_logs g
          JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id
         WHERE ct.convoy_id = c.id ORDER BY g.timestamp DESC LIMIT 1) AS current_lng,
       (SELECT COUNT(*) FROM alerts a WHERE a.convoy_id = c.id AND a.resolved_at IS NULL) AS exception_count,
       c.seal_intact
     FROM convoys c
    WHERE c.org_id = $1
      AND c.id IN (${placeholders})
      AND c.deleted_at IS NULL
    ORDER BY c.created_at DESC`,
    [org_id, ...convoy_ids],
  );

  const rows = result.rows.map(r => ({
    convoy_id: r.convoy_id,
    reference: r.reference,
    status: r.status,
    origin: r.origin,
    destination: r.destination,
    eta: r.eta ? new Date(r.eta).toISOString() : null,
    last_ping_at: r.last_ping_at ? new Date(r.last_ping_at).toISOString() : null,
    progress_pct: null, // computed by client from /eta endpoint per-convoy
    exception_count: parseInt(r.exception_count) || 0,
    seal_status: r.seal_intact === false ? 'compromised' : r.seal_intact === true ? 'intact' : 'unverified',
    current_location: r.current_lat ? { lat: parseFloat(r.current_lat), lng: parseFloat(r.current_lng) } : null,
  }));

  res.json({ data: rows });
}));

// POST /api/v1/portal/clients — create a cargo client
router.post('/clients', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const { email, name, company } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'email and name required' });
  const result = await req.db(
    `INSERT INTO cargo_clients (org_id, email, name, company)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id, email) DO UPDATE SET name = EXCLUDED.name, company = EXCLUDED.company
     RETURNING id, org_id, email, name, company, created_at`,
    [req.user.org_id, email.toLowerCase().trim(), name, company ?? null],
  );
  res.status(201).json({ data: result.rows[0] });
}));

// POST /api/v1/portal/clients/:id/links — link client to a convoy
router.post('/clients/:id/links', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const { convoy_id, shipment_id, show_value } = req.body;
  if (!convoy_id) return res.status(400).json({ error: 'convoy_id required' });
  const result = await req.db(
    `INSERT INTO cargo_client_links (org_id, client_id, convoy_id, shipment_id, show_value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id, convoy_id) DO UPDATE SET show_value = EXCLUDED.show_value
     RETURNING id, client_id, convoy_id, show_value`,
    [req.user.org_id, req.params.id, convoy_id, shipment_id ?? null, show_value ?? false],
  );
  res.status(201).json({ data: result.rows[0] });
}));

// GET /api/v1/portal/clients — list clients for the org
router.get('/clients', authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT id, email, name, company, last_login_at, created_at FROM cargo_clients
     WHERE deleted_at IS NULL ORDER BY name ASC`,
    [],
  );
  res.json({ data: result.rows });
}));

module.exports = router;
