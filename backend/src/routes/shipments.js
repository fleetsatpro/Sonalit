const router = require('express').Router();
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');

router.use(authenticate, attachOrgDb);

// attachOrgDb only sets req.db when req.user.org_id is present. Fail closed
// rather than let a request fall through to an unscoped connection — see
// geofences.js for the RLS-bypass mechanics this guards against. shipments
// had no org_id/RLS at all until this migration, so this is the first time
// the route is actually tenant-isolated.
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

function generateTrackingNumber() {
  const prefix = 'FO';
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

// GET /shipments
router.get('/', asyncHandler(async (req, res) => {
  const { status, priority, convoy_id, limit = 50, offset = 0, search } = req.query;
  const filters = ['s.deleted_at IS NULL'];
  const params = [];
  if (status) { params.push(status); filters.push(`s.status=$${params.length}`); }
  if (priority) { params.push(priority); filters.push(`s.priority=$${params.length}`); }
  if (convoy_id) { params.push(convoy_id); filters.push(`s.convoy_id=$${params.length}`); }
  if (search) { params.push(`%${search}%`); filters.push(`(s.tracking_number ILIKE $${params.length} OR s.customer_name ILIKE $${params.length})`); }
  params.push(limit, offset);
  const result = await req.db(
    `SELECT s.*, c.name AS convoy_name, v.registration AS vehicle_reg, d.name AS driver_name
       FROM shipments s
       LEFT JOIN convoys c ON c.id = s.convoy_id
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN drivers d ON d.id = s.driver_id
      WHERE ${filters.join(' AND ')}
      ORDER BY s.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = await req.db(`SELECT COUNT(*) FROM shipments s WHERE ${filters.join(' AND ')}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));

// GET /shipments/stats/summary — declared before /:id so it isn't swallowed by the param route
router.get('/stats/summary', asyncHandler(async (req, res) => {
  const result = await req.db(`
    SELECT
      COUNT(*) total,
      COUNT(*) FILTER (WHERE status='in_transit') in_transit,
      COUNT(*) FILTER (WHERE status='delivered') delivered,
      COUNT(*) FILTER (WHERE status='pending') pending,
      COUNT(*) FILTER (WHERE status='failed') failed,
      COUNT(*) FILTER (WHERE priority='critical') critical,
      AVG(EXTRACT(EPOCH FROM (actual_delivery - scheduled_delivery))/3600) FILTER (WHERE actual_delivery IS NOT NULL AND scheduled_delivery IS NOT NULL) avg_delay_hours
    FROM shipments WHERE deleted_at IS NULL`);
  res.json({ data: result.rows[0] });
}));

// GET /shipments/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const param = req.params.id;
  const isTracking = param.startsWith('FO-');
  const result = await req.db(
    `SELECT s.*, c.name AS convoy_name, v.registration AS vehicle_reg, d.name AS driver_name
       FROM shipments s
       LEFT JOIN convoys c ON c.id = s.convoy_id
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
       LEFT JOIN drivers d ON d.id = s.driver_id
      WHERE ${isTracking ? 's.tracking_number=$1' : 's.id=$1'} AND s.deleted_at IS NULL`,
    [param],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Shipment not found' });
  const checkpoints = await req.db('SELECT * FROM checkpoints WHERE shipment_id=$1 ORDER BY sequence_order', [result.rows[0].id]);
  res.json({ data: { ...result.rows[0], checkpoints: checkpoints.rows } });
}));

// POST /shipments
router.post('/', asyncHandler(async (req, res) => {
  const {
    convoy_id, vehicle_id, driver_id, customer_name, customer_ref,
    priority = 'standard', origin_address, destination_address,
    cargo_description, cargo_weight_kg, cargo_value, currency = 'USD',
    requires_temp_control, temp_min, temp_max, is_hazmat, hazmat_class,
    scheduled_pickup, scheduled_delivery, notes, checkpoints: cpData,
  } = req.body;
  if (!customer_name || !origin_address || !destination_address) {
    return res.status(400).json({ error: 'customer_name, origin_address, destination_address required' });
  }
  const tracking = generateTrackingNumber();
  const result = await req.db(
    `INSERT INTO shipments (org_id, tracking_number, convoy_id, vehicle_id, driver_id, customer_name, customer_ref,
      priority, origin_address, destination_address, cargo_description, cargo_weight_kg, cargo_value, currency,
      requires_temp_control, temp_min, temp_max, is_hazmat, hazmat_class,
      scheduled_pickup, scheduled_delivery, notes, created_by)
     VALUES ((current_setting('app.current_org_id',true))::uuid,
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [tracking, convoy_id || null, vehicle_id || null, driver_id || null, customer_name, customer_ref || null,
     priority, origin_address, destination_address, cargo_description, cargo_weight_kg || null, cargo_value || null, currency,
     requires_temp_control || false, temp_min || null, temp_max || null, is_hazmat || false, hazmat_class || null,
     scheduled_pickup || null, scheduled_delivery || null, notes || null, req.user.id],
  );
  if (cpData && Array.isArray(cpData)) {
    for (let i = 0; i < cpData.length; i++) {
      await req.db(
        'INSERT INTO checkpoints (shipment_id, name, location_name, lat, lng, sequence_order, expected_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [result.rows[0].id, cpData[i].name, cpData[i].location_name, cpData[i].lat, cpData[i].lng, i + 1, cpData[i].expected_at],
      );
    }
  }
  res.status(201).json({ data: result.rows[0] });
}));

// PATCH /shipments/:id/status
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status, notes, pod_signature, pod_notes } = req.body;
  const setPickup = status === 'picked_up' ? 'actual_pickup = NOW(),' : '';
  const setDelivery = status === 'delivered' ? 'actual_delivery = NOW(), pod_at = NOW(),' : '';
  const result = await req.db(
    `UPDATE shipments
        SET status = $1,
            notes = COALESCE($2, notes),
            pod_signature = COALESCE($3, pod_signature),
            pod_notes = COALESCE($4, pod_notes),
            ${setPickup} ${setDelivery}
            updated_at = NOW()
      WHERE id=$5 AND deleted_at IS NULL RETURNING *`,
    [status, notes || null, status === 'delivered' ? (pod_signature || null) : null, status === 'delivered' ? (pod_notes || null) : null, req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ data: result.rows[0] });
}));

module.exports = router;
