/**
 * Portal client-facing and client-management routes.
 * Client session: shipment summaries and scoped manifest.
 * Operator: cargo client CRUD/linking/magic-link and manifest item creation.
 */
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { clientAuth } = require('../middleware/clientAuth');
const { asyncHandler } = require('../middleware/error');
const { query } = require('../config/database');
const { normalizePhone } = require('../utils/phone');

router.get('/shipments', clientAuth, asyncHandler(async (req, res) => {
  const { org_id, convoy_ids } = req.client;
  if (!convoy_ids.length) return res.json({ data: [] });
  const placeholders = convoy_ids.map((_, i) => `$${i + 2}`).join(',');
  const result = await query(
    `SELECT c.id AS convoy_id, COALESCE(c.reference, c.name) AS reference, c.status,
            COALESCE(c.origin, c.route_origin) AS origin,
            COALESCE(c.destination, c.route_destination) AS destination,
            COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS eta,
            (SELECT g.timestamp FROM gps_logs g JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id WHERE ct.convoy_id = c.id ORDER BY g.timestamp DESC LIMIT 1) AS last_ping_at,
            (SELECT g.lat FROM gps_logs g JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id WHERE ct.convoy_id = c.id ORDER BY g.timestamp DESC LIMIT 1) AS current_lat,
            (SELECT g.lng FROM gps_logs g JOIN convoy_trucks ct ON ct.vehicle_id = g.vehicle_id WHERE ct.convoy_id = c.id ORDER BY g.timestamp DESC LIMIT 1) AS current_lng,
            (SELECT COUNT(*) FROM alerts a WHERE a.convoy_id = c.id AND a.resolved_at IS NULL) AS exception_count,
            c.seal_intact
       FROM convoys c
      WHERE c.org_id = $1 AND c.id IN (${placeholders}) AND c.deleted_at IS NULL
      ORDER BY c.created_at DESC`,
    [org_id, ...convoy_ids],
  );
  res.json({ data: result.rows.map(r => ({
    convoy_id: r.convoy_id, reference: r.reference, status: r.status,
    origin: r.origin, destination: r.destination,
    eta: r.eta ? new Date(r.eta).toISOString() : null,
    last_ping_at: r.last_ping_at ? new Date(r.last_ping_at).toISOString() : null,
    progress_pct: null, exception_count: parseInt(r.exception_count, 10) || 0,
    seal_status: r.seal_intact === false ? 'compromised' : r.seal_intact === true ? 'intact' : 'unverified',
    current_location: r.current_lat != null && r.current_lng != null ? { lat: parseFloat(r.current_lat), lng: parseFloat(r.current_lng) } : null,
  })) });
}));

router.post('/clients', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const { email, name, company, phone, country } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'email and name required' });
  let normalizedPhone;
  try { normalizedPhone = normalizePhone(phone, country || 'Kenya'); }
  catch (error) { return res.status(400).json({ error: error.message || 'Enter a valid phone number.' }); }
  const result = await req.db(
    `INSERT INTO cargo_clients (org_id, email, name, company, phone)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id, email) DO UPDATE SET name = EXCLUDED.name, company = EXCLUDED.company, phone = EXCLUDED.phone
     RETURNING id, org_id, email, name, company, phone, created_at`,
    [req.user.org_id, email.toLowerCase().trim(), name, company ?? null, normalizedPhone],
  );
  res.status(201).json({ data: result.rows[0] });
}));

router.post('/clients/:id/links', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const { convoy_id, shipment_id, show_value } = req.body;
  if (!convoy_id) return res.status(400).json({ error: 'convoy_id required' });
  const client = await req.db(`SELECT id FROM cargo_clients WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [req.params.id, req.user.org_id]);
  if (!client.rows.length) return res.status(404).json({ error: 'Client not found' });
  const convoy = await req.db(`SELECT id FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [convoy_id, req.user.org_id]);
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const result = await req.db(
    `INSERT INTO cargo_client_links (org_id, client_id, convoy_id, shipment_id, show_value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id, convoy_id) DO UPDATE SET show_value = EXCLUDED.show_value
     RETURNING id, client_id, convoy_id, shipment_id, show_value, created_at`,
    [req.user.org_id, req.params.id, convoy_id, shipment_id ?? null, show_value ?? false],
  );
  res.status(201).json({ data: result.rows[0] });
}));

router.post('/clients/:id/magic-link', authenticate, attachOrgDb, authorize('admin', 'dispatcher'), asyncHandler(async (req, res) => {
  const clientResult = await req.db(`SELECT id, org_id, email FROM cargo_clients WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [req.params.id, req.user.org_id]);
  if (!clientResult.rows.length) return res.status(404).json({ error: 'Client not found' });
  const { id: client_id, org_id, email } = clientResult.rows[0];
  const crypto = require('crypto');
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await req.db(`INSERT INTO client_magic_links (org_id, client_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`, [org_id, client_id, tokenHash, expiresAt]);
  const portalUrl = process.env.PORTAL_URL ?? `https://${req.hostname}`;
  res.json({ data: { url: `${portalUrl}/portal/login?token=${rawToken}`, email, expires_at: expiresAt.toISOString() } });
}));

router.get('/clients', authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT cc.id, cc.email, cc.name, cc.company, cc.phone, cc.last_login_at, cc.created_at,
            COUNT(DISTINCT ccl.convoy_id)::int AS linked_convoys,
            COUNT(DISTINCT CASE WHEN c.status = 'in_transit' THEN ccl.convoy_id END)::int AS active_convoys,
            COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN ccl.convoy_id END)::int AS completed_convoys
       FROM cargo_clients cc
       LEFT JOIN cargo_client_links ccl ON ccl.client_id = cc.id AND ccl.org_id = cc.org_id
       LEFT JOIN convoys c ON c.id = ccl.convoy_id AND c.org_id = cc.org_id AND c.deleted_at IS NULL
      WHERE cc.org_id = $1 AND cc.deleted_at IS NULL
      GROUP BY cc.id ORDER BY cc.name ASC`,
    [req.user.org_id],
  );
  res.json({ data: result.rows });
}));

router.get('/clients/:id/links', authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT ccl.id, ccl.client_id, ccl.convoy_id, ccl.shipment_id, ccl.show_value, ccl.created_at,
            COALESCE(c.reference, c.name) AS reference, c.status,
            COALESCE(c.origin, c.route_origin) AS origin, COALESCE(c.destination, c.route_destination) AS destination,
            COALESCE(c.estimated_arrival_at, c.estimated_arrival) AS eta, c.seal_intact,
            (SELECT COUNT(*) FROM alerts a WHERE a.convoy_id = c.id AND a.resolved_at IS NULL)::int AS exception_count
       FROM cargo_client_links ccl JOIN convoys c ON c.id = ccl.convoy_id
      WHERE ccl.client_id = $1 AND ccl.org_id = $2
      ORDER BY ccl.created_at DESC`,
    [req.params.id, req.user.org_id],
  );
  res.json({ data: result.rows });
}));

router.get('/convoy/:convoy_id/manifest', clientAuth, asyncHandler(async (req, res) => {
  const { org_id, convoy_ids, client_id } = req.client;
  const { convoy_id } = req.params;
  if (!convoy_ids.includes(convoy_id)) return res.status(403).json({ error: 'Not authorised for this convoy' });
  const linkResult = await query(`SELECT show_value FROM cargo_client_links WHERE client_id = $1 AND convoy_id = $2 AND org_id = $3`, [client_id, convoy_id, org_id]);
  const showValue = linkResult.rows[0]?.show_value ?? false;
  const shipResult = await query(`SELECT s.id AS shipment_id, s.tracking_number AS reference, s.cargo_description, s.cargo_weight_kg AS total_weight_kg, s.metadata->>'customs_ref' AS customs_ref FROM shipments s JOIN convoys c ON c.id = s.convoy_id WHERE s.convoy_id = $1 AND c.org_id = $2 AND s.deleted_at IS NULL ORDER BY s.created_at`, [convoy_id, org_id]);
  const shipIds = shipResult.rows.map(r => r.shipment_id);
  let itemRows = [];
  if (shipIds.length) {
    const ph = shipIds.map((_, i) => `$${i + 2}`).join(',');
    const itemResult = await query(`SELECT id, shipment_id, description, quantity, weight_kg, value, currency, handling FROM shipment_manifest_items WHERE org_id = $1 AND shipment_id IN (${ph}) AND deleted_at IS NULL ORDER BY shipment_id, created_at`, [org_id, ...shipIds]);
    itemRows = itemResult.rows;
  }
  const byShipment = {};
  for (const item of itemRows) { if (!byShipment[item.shipment_id]) byShipment[item.shipment_id] = []; byShipment[item.shipment_id].push({ id:item.id, description:item.description, quantity:parseInt(item.quantity,10), weight_kg:item.weight_kg!=null?parseFloat(item.weight_kg):null, value:showValue&&item.value!=null?parseFloat(item.value):null, currency:showValue?item.currency:null, handling:item.handling }); }
  const data = shipResult.rows.map(r => { const items=byShipment[r.shipment_id]??[]; const declared_value=showValue&&items.length?parseFloat(items.reduce((sum,it)=>sum+(it.value??0)*it.quantity,0).toFixed(2))||null:null; return { shipment_id:r.shipment_id, reference:r.reference, cargo_description:r.cargo_description??null, total_weight_kg:r.total_weight_kg!=null?parseFloat(r.total_weight_kg):null, declared_value, customs_ref:r.customs_ref??null, items }; });
  res.json({ data, show_value: showValue });
}));

router.post('/convoy/:convoy_id/shipments/:shipment_id/manifest-items', authenticate, attachOrgDb, authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const { description, quantity, weight_kg, value, currency, handling } = req.body;
  if (!description || !quantity) return res.status(400).json({ error: 'description and quantity required' });
  const check = await req.db(`SELECT s.id FROM shipments s JOIN convoys c ON c.id = s.convoy_id WHERE s.id = $1 AND s.convoy_id = $2 AND c.org_id = $3 AND s.deleted_at IS NULL`, [req.params.shipment_id, req.params.convoy_id, req.user.org_id]);
  if (!check.rows.length) return res.status(404).json({ error: 'Shipment not found' });
  const result = await req.db(`INSERT INTO shipment_manifest_items (org_id, shipment_id, description, quantity, weight_kg, value, currency, handling) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, shipment_id, description, quantity, weight_kg, value, currency, handling`, [req.user.org_id, req.params.shipment_id, description, parseInt(quantity, 10), weight_kg ?? null, value ?? null, currency ?? null, handling ?? 'standard']);
  res.status(201).json({ data: result.rows[0] });
}));

module.exports = router;
