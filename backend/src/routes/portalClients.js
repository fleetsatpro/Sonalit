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

// ── Cargo manifest ─────────────────────────────────────────────────────────────

// GET /api/v1/portal/convoy/:convoy_id/manifest (clientAuth)
router.get('/convoy/:convoy_id/manifest', clientAuth, asyncHandler(async (req, res) => {
  const { org_id, convoy_ids, client_id } = req.client;
  const { convoy_id } = req.params;

  // §00: convoy must be in the client's link set
  if (!convoy_ids.includes(convoy_id)) {
    return res.status(403).json({ error: 'Not authorised for this convoy' });
  }

  const linkResult = await query(
    `SELECT show_value FROM cargo_client_links
     WHERE client_id = $1 AND convoy_id = $2 AND org_id = $3`,
    [client_id, convoy_id, org_id],
  );
  const showValue = linkResult.rows[0]?.show_value ?? false;

  const shipResult = await query(
    `SELECT s.id AS shipment_id,
            s.tracking_number AS reference,
            s.cargo_description,
            s.cargo_weight_kg AS total_weight_kg,
            s.metadata->>'customs_ref' AS customs_ref
     FROM shipments s
     JOIN convoys c ON c.id = s.convoy_id
    WHERE s.convoy_id = $1 AND c.org_id = $2 AND s.deleted_at IS NULL
    ORDER BY s.created_at`,
    [convoy_id, org_id],
  );

  const shipIds = shipResult.rows.map(r => r.shipment_id);
  let itemRows = [];
  if (shipIds.length > 0) {
    const ph = shipIds.map((_, i) => `$${i + 2}`).join(',');
    const itemResult = await query(
      `SELECT id, shipment_id, description, quantity, weight_kg, value, currency, handling
       FROM shipment_manifest_items
      WHERE org_id = $1 AND shipment_id IN (${ph}) AND deleted_at IS NULL
      ORDER BY shipment_id, created_at`,
      [org_id, ...shipIds],
    );
    itemRows = itemResult.rows;
  }

  const byShipment = {};
  for (const item of itemRows) {
    if (!byShipment[item.shipment_id]) byShipment[item.shipment_id] = [];
    byShipment[item.shipment_id].push({
      id: item.id,
      description: item.description,
      quantity: parseInt(item.quantity),
      weight_kg: item.weight_kg != null ? parseFloat(item.weight_kg) : null,
      value: showValue && item.value != null ? parseFloat(item.value) : null,
      currency: showValue ? item.currency : null,
      handling: item.handling,
    });
  }

  const data = shipResult.rows.map(r => {
    const items = byShipment[r.shipment_id] ?? [];
    let declared_value = null;
    if (showValue && items.length > 0) {
      const total = items.reduce((sum, it) => sum + (it.value ?? 0) * it.quantity, 0);
      if (total > 0) declared_value = parseFloat(total.toFixed(2));
    }
    return {
      shipment_id: r.shipment_id,
      reference: r.reference,
      cargo_description: r.cargo_description ?? null,
      total_weight_kg: r.total_weight_kg != null ? parseFloat(r.total_weight_kg) : null,
      declared_value,
      customs_ref: r.customs_ref ?? null,
      items,
    };
  });

  res.json({ data, show_value: showValue });
}));

// POST /api/v1/portal/convoy/:convoy_id/shipments/:shipment_id/manifest-items (operator)
router.post(
  '/convoy/:convoy_id/shipments/:shipment_id/manifest-items',
  authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'),
  asyncHandler(async (req, res) => {
    const { description, quantity, weight_kg, value, currency, handling } = req.body;
    if (!description || !quantity) return res.status(400).json({ error: 'description and quantity required' });

    // Verify the shipment belongs to this convoy + org before inserting
    const check = await req.db(
      `SELECT s.id FROM shipments s JOIN convoys c ON c.id = s.convoy_id
       WHERE s.id = $1 AND s.convoy_id = $2 AND c.org_id = $3 AND s.deleted_at IS NULL`,
      [req.params.shipment_id, req.params.convoy_id, req.user.org_id],
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Shipment not found' });

    const result = await req.db(
      `INSERT INTO shipment_manifest_items
         (org_id, shipment_id, description, quantity, weight_kg, value, currency, handling)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, shipment_id, description, quantity, weight_kg, value, currency, handling`,
      [req.user.org_id, req.params.shipment_id, description, parseInt(quantity),
       weight_kg ?? null, value ?? null, currency ?? null, handling ?? 'standard'],
    );
    res.status(201).json({ data: result.rows[0] });
  }),
);

module.exports = router;
