const router = require('express').Router();
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');

router.use(authenticate, attachOrgDb);
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

function genCode(prefix) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

function paginate(query) {
  const limit = Math.min(200, parseInt(query.limit) || 50);
  const offset = parseInt(query.offset) || 0;
  return { limit, offset };
}

// ── helpers for DRY list/get/create/update on cds_ tables ──

async function listRows(req, res, table, { joins = '', selectCols = '*', searchCols = [], extraFilters = [] } = {}) {
  const { limit, offset } = paginate(req.query);
  const filters = [`t.deleted_at IS NULL`, ...extraFilters];
  const params = [];
  if (req.query.status) { params.push(req.query.status); filters.push(`t.status=$${params.length}`); }
  if (req.query.search && searchCols.length) {
    params.push(`%${req.query.search}%`);
    filters.push(`(${searchCols.map(c => `${c} ILIKE $${params.length}`).join(' OR ')})`);
  }
  Object.entries(req.query).forEach(([k, v]) => {
    if (['status', 'search', 'limit', 'offset'].includes(k)) return;
    if (k.endsWith('_id')) { params.push(v); filters.push(`t.${k}=$${params.length}`); }
  });
  const where = filters.join(' AND ');
  params.push(limit, offset);
  const result = await req.db(
    `SELECT ${selectCols} FROM ${table} t ${joins} WHERE ${where} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) FROM ${table} t ${joins} WHERE ${where}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}

async function getRow(req, res, table, { joins = '', selectCols = '*' } = {}) {
  const result = await req.db(
    `SELECT ${selectCols} FROM ${table} t ${joins} WHERE t.id=$1 AND t.deleted_at IS NULL`, [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ data: result.rows[0] });
}

async function createRow(req, res, table, fields, { genField, genPrefix } = {}) {
  const cols = [...fields];
  const vals = cols.map(f => req.body[f] ?? null);
  if (genField) { cols.unshift(genField); vals.unshift(genCode(genPrefix)); }
  cols.push('org_id', 'created_by');
  vals.push(req.user.org_id, req.user.id);
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
  const result = await req.db(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`, vals
  );
  res.status(201).json({ data: result.rows[0] });
}

async function updateRow(req, res, table, fields) {
  const sets = [];
  const params = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); }
  });
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  sets.push('updated_at=NOW()');
  params.push(req.params.id);
  const result = await req.db(
    `UPDATE ${table} SET ${sets.join(',')} WHERE id=$${params.length} AND deleted_at IS NULL RETURNING *`, params
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ data: result.rows[0] });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Dashboard
// ══════════════════════════════════════════════════════════════════════════════

router.get('/dashboard', asyncHandler(async (req, res) => {
  const kpis = await req.db(`
    SELECT
      (SELECT COUNT(*) FROM cds_containers WHERE deleted_at IS NULL) AS active_containers,
      (SELECT COUNT(*) FROM cds_trips WHERE status='in_transit' AND deleted_at IS NULL) AS in_transit,
      (SELECT COUNT(*) FROM cds_trips WHERE status='delivered' AND delivered_at::date=CURRENT_DATE AND deleted_at IS NULL) AS delivered_today,
      (SELECT COUNT(*) FROM cds_locks WHERE status='active' AND deleted_at IS NULL) AS active_locks,
      (SELECT COUNT(*) FROM cds_locks WHERE status='removed' AND deleted_at IS NULL) AS locks_removed,
      (SELECT COUNT(*) FROM cds_trips WHERE status='pending_unclamp' AND deleted_at IS NULL) AS pending_unclamp,
      (SELECT COUNT(*) FROM cds_trips WHERE status='delayed' AND deleted_at IS NULL) AS delayed_trips,
      (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - departed_at))/3600)::numeric,1) FROM cds_trips WHERE delivered_at IS NOT NULL AND departed_at IS NOT NULL AND deleted_at IS NULL) AS avg_transit_hours
  `);
  const activity = await req.db(
    `SELECT * FROM cds_audit_log ORDER BY created_at DESC LIMIT 20`
  );
  res.json({ data: { ...kpis.rows[0], recent_activity: activity.rows } });
}));

// ══════════════════════════════════════════════════════════════════════════════
// 2. Trips
// ══════════════════════════════════════════════════════════════════════════════

const TRIP_JOINS = `LEFT JOIN cds_customers cu ON cu.id=t.customer_id
  LEFT JOIN cds_drivers dr ON dr.id=t.driver_id
  LEFT JOIN cds_vehicles ve ON ve.id=t.vehicle_id`;
const TRIP_COLS = `t.*, cu.name AS customer_name, dr.name AS driver_name, ve.registration AS vehicle_reg`;

router.get('/trips', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_trips', {
    joins: TRIP_JOINS, selectCols: TRIP_COLS,
    searchCols: ['t.trip_number', 'cu.name', 'dr.name'],
  });
}));

router.get('/trips/:id', asyncHandler(async (req, res) => {
  await getRow(req, res, 'cds_trips', { joins: TRIP_JOINS, selectCols: TRIP_COLS });
}));

router.post('/trips', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_trips',
    ['customer_id', 'driver_id', 'vehicle_id', 'container_id', 'lock_id', 'transporter_id',
     'origin', 'destination', 'scheduled_departure', 'scheduled_arrival', 'cargo_description', 'notes'],
    { genField: 'trip_number', genPrefix: 'CDS' }
  );
}));

router.patch('/trips/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_trips',
    ['customer_id', 'driver_id', 'vehicle_id', 'container_id', 'lock_id', 'transporter_id',
     'origin', 'destination', 'scheduled_departure', 'scheduled_arrival', 'cargo_description', 'notes', 'status']
  );
}));

const TRIP_TRANSITIONS = {
  planned:          ['dispatched', 'cancelled'],
  dispatched:       ['loading', 'cancelled'],
  loading:          ['in_transit', 'cancelled'],
  in_transit:       ['pending_unclamp', 'delayed', 'incident'],
  delayed:          ['in_transit', 'pending_unclamp', 'incident'],
  pending_unclamp:  ['delivered'],
  incident:         ['in_transit', 'cancelled'],
  delivered:        [],
  cancelled:        [],
};

router.post('/trips/:id/transition', asyncHandler(async (req, res) => {
  const { to_status, notes, lat, lng } = req.body;
  if (!to_status) return res.status(400).json({ error: 'to_status required' });

  const current = await req.db('SELECT id, status FROM cds_trips WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
  if (!current.rows.length) return res.status(404).json({ error: 'Trip not found' });

  const allowed = TRIP_TRANSITIONS[current.rows[0].status] || [];
  if (!allowed.includes(to_status)) {
    return res.status(422).json({ error: `Cannot transition from ${current.rows[0].status} to ${to_status}` });
  }

  const extra = to_status === 'in_transit' ? ', departed_at=NOW()' : to_status === 'delivered' ? ', delivered_at=NOW()' : '';
  const result = await req.db(
    `UPDATE cds_trips SET status=$1, notes=COALESCE($2,notes)${extra}, updated_at=NOW() WHERE id=$3 RETURNING *`,
    [to_status, notes || null, req.params.id]
  );

  await req.db(
    `INSERT INTO cds_audit_log (entity_type, entity_id, action, details, lat, lng, performed_by, org_id)
     VALUES ('trip',$1,'transition',$2,$3,$4,$5,$6)`,
    [req.params.id, JSON.stringify({ from: current.rows[0].status, to: to_status, notes }), lat || null, lng || null, req.user.id, req.user.org_id]
  );

  res.json({ data: result.rows[0] });
}));

// ══════════════════════════════════════════════════════════════════════════════
// 3. Containers
// ══════════════════════════════════════════════════════════════════════════════

router.get('/containers', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_containers', { searchCols: ['t.container_number', 't.type'] });
}));
router.get('/containers/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_containers'); }));
router.post('/containers', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_containers', ['container_number', 'type', 'size', 'weight_kg', 'max_payload_kg', 'status', 'notes']);
}));
router.patch('/containers/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_containers', ['container_number', 'type', 'size', 'weight_kg', 'max_payload_kg', 'status', 'notes']);
}));

// ══════════════════════════════════════════════════════════════════════════════
// 4. Electronic Locks
// ══════════════════════════════════════════════════════════════════════════════

router.get('/locks', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_locks', { searchCols: ['t.serial_number', 't.model'] });
}));
router.get('/locks/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_locks'); }));
router.post('/locks', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_locks', ['serial_number', 'model', 'firmware_version', 'status', 'battery_level', 'notes']);
}));
router.patch('/locks/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_locks', ['serial_number', 'model', 'firmware_version', 'status', 'battery_level', 'notes']);
}));
router.get('/locks/:id/events', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query);
  const result = await req.db(
    `SELECT * FROM cds_lock_events WHERE lock_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.params.id, limit, offset]
  );
  const total = await req.db('SELECT COUNT(*) FROM cds_lock_events WHERE lock_id=$1', [req.params.id]);
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));
router.post('/locks/:id/events', asyncHandler(async (req, res) => {
  const { event_type, lat, lng, details } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });
  const result = await req.db(
    `INSERT INTO cds_lock_events (lock_id, event_type, lat, lng, details, performed_by, org_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, event_type, lat || null, lng || null, JSON.stringify(details || {}), req.user.id, req.user.org_id]
  );
  res.status(201).json({ data: result.rows[0] });
}));

// ══════════════════════════════════════════════════════════════════════════════
// 5. Vehicles
// ══════════════════════════════════════════════════════════════════════════════

router.get('/vehicles', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_vehicles', { searchCols: ['t.registration', 't.make', 't.model'] });
}));
router.get('/vehicles/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_vehicles'); }));
router.post('/vehicles', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_vehicles', ['registration', 'make', 'model', 'year', 'type', 'capacity_tons', 'status', 'notes']);
}));
router.patch('/vehicles/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_vehicles', ['registration', 'make', 'model', 'year', 'type', 'capacity_tons', 'status', 'notes']);
}));

// ══════════════════════════════════════════════════════════════════════════════
// 6. Drivers
// ══════════════════════════════════════════════════════════════════════════════

router.get('/drivers', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_drivers', { searchCols: ['t.name', 't.phone', 't.license_number'] });
}));
router.get('/drivers/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_drivers'); }));
router.post('/drivers', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_drivers', ['name', 'phone', 'email', 'license_number', 'license_expiry', 'transporter_id', 'status', 'notes']);
}));
router.patch('/drivers/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_drivers', ['name', 'phone', 'email', 'license_number', 'license_expiry', 'transporter_id', 'status', 'notes']);
}));

// ══════════════════════════════════════════════════════════════════════════════
// 7. Customers
// ══════════════════════════════════════════════════════════════════════════════

router.get('/customers', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_customers', { searchCols: ['t.name', 't.email', 't.phone'] });
}));
router.get('/customers/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_customers'); }));
router.post('/customers', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_customers', ['name', 'email', 'phone', 'address', 'contact_person', 'notes']);
}));
router.patch('/customers/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_customers', ['name', 'email', 'phone', 'address', 'contact_person', 'notes']);
}));

// ══════════════════════════════════════════════════════════════════════════════
// 8. Transporters
// ══════════════════════════════════════════════════════════════════════════════

router.get('/transporters', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_transporters', { searchCols: ['t.name', 't.email', 't.phone'] });
}));
router.get('/transporters/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_transporters'); }));
router.post('/transporters', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_transporters', ['name', 'email', 'phone', 'address', 'fleet_size', 'license_number', 'notes']);
}));
router.patch('/transporters/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_transporters', ['name', 'email', 'phone', 'address', 'fleet_size', 'license_number', 'notes']);
}));

// ══════════════════════════════════════════════════════════════════════════════
// 9. Bookings
// ══════════════════════════════════════════════════════════════════════════════

router.get('/bookings', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_bookings', {
    joins: 'LEFT JOIN cds_customers cu ON cu.id=t.customer_id',
    selectCols: 't.*, cu.name AS customer_name',
    searchCols: ['t.booking_number', 'cu.name'],
  });
}));
router.get('/bookings/:id', asyncHandler(async (req, res) => {
  await getRow(req, res, 'cds_bookings', {
    joins: 'LEFT JOIN cds_customers cu ON cu.id=t.customer_id',
    selectCols: 't.*, cu.name AS customer_name',
  });
}));
router.post('/bookings', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_bookings',
    ['customer_id', 'origin', 'destination', 'cargo_description', 'container_type', 'requested_date', 'notes'],
    { genField: 'booking_number', genPrefix: 'BK' }
  );
}));
router.patch('/bookings/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_bookings',
    ['customer_id', 'origin', 'destination', 'cargo_description', 'container_type', 'requested_date', 'status', 'notes']
  );
}));

// ══════════════════════════════════════════════════════════════════════════════
// 10. Alerts
// ══════════════════════════════════════════════════════════════════════════════

router.get('/alerts', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query);
  const filters = ['deleted_at IS NULL'];
  const params = [];
  if (req.query.severity) { params.push(req.query.severity); filters.push(`severity=$${params.length}`); }
  if (req.query.type) { params.push(req.query.type); filters.push(`alert_type=$${params.length}`); }
  if (req.query.acknowledged === 'true') filters.push('acknowledged_at IS NOT NULL');
  else if (req.query.acknowledged === 'false') filters.push('acknowledged_at IS NULL');
  params.push(limit, offset);
  const result = await req.db(
    `SELECT * FROM cds_alerts WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) FROM cds_alerts WHERE ${filters.join(' AND ')}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));

router.post('/alerts/:id/acknowledge', asyncHandler(async (req, res) => {
  const result = await req.db(
    `UPDATE cds_alerts SET acknowledged_at=NOW(), acknowledged_by=$1, updated_at=NOW()
     WHERE id=$2 AND acknowledged_at IS NULL AND deleted_at IS NULL RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Alert not found or already acknowledged' });
  res.json({ data: result.rows[0] });
}));

// ══════════════════════════════════════════════════════════════════════════════
// 11. Incidents
// ══════════════════════════════════════════════════════════════════════════════

router.get('/incidents', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_incidents', { searchCols: ['t.incident_number', 't.title'] });
}));
router.get('/incidents/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_incidents'); }));
router.post('/incidents', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_incidents',
    ['trip_id', 'title', 'description', 'severity', 'type', 'assigned_to'],
    { genField: 'incident_number', genPrefix: 'INC' }
  );
}));
router.patch('/incidents/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_incidents',
    ['title', 'description', 'severity', 'status', 'type', 'assigned_to', 'resolution', 'resolved_at']
  );
}));

// ══════════════════════════════════════════════════════════════════════════════
// 12. Geofences
// ══════════════════════════════════════════════════════════════════════════════

router.get('/geofences', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_geofences', { searchCols: ['t.name'] });
}));
router.post('/geofences', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_geofences', ['name', 'type', 'lat', 'lng', 'radius_m', 'geojson', 'notes']);
}));
router.patch('/geofences/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_geofences', ['name', 'type', 'lat', 'lng', 'radius_m', 'geojson', 'notes', 'status']);
}));
router.delete('/geofences/:id', asyncHandler(async (req, res) => {
  const result = await req.db(
    `UPDATE cds_geofences SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ data: { id: result.rows[0].id, deleted: true } });
}));

// ══════════════════════════════════════════════════════════════════════════════
// 13. Documents
// ══════════════════════════════════════════════════════════════════════════════

router.get('/documents', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_documents', {
    searchCols: ['t.title', 't.document_type'],
    extraFilters: req.query.entity_type ? [`t.entity_type='${req.query.entity_type.replace(/'/g, "''")}'`] : [],
  });
}));
router.post('/documents', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_documents',
    ['entity_type', 'entity_id', 'title', 'document_type', 'file_url', 'file_size', 'mime_type', 'notes']
  );
}));

// ══════════════════════════════════════════════════════════════════════════════
// 14. Reports
// ══════════════════════════════════════════════════════════════════════════════

router.get('/reports', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_reports', { searchCols: ['t.title', 't.report_type'] });
}));
router.post('/reports', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_reports', ['title', 'report_type', 'parameters', 'status']);
}));

// ══════════════════════════════════════════════════════════════════════════════
// 15. Audit
// ══════════════════════════════════════════════════════════════════════════════

router.get('/audit', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query);
  const filters = [];
  const params = [];
  if (req.query.entity_type) { params.push(req.query.entity_type); filters.push(`entity_type=$${params.length}`); }
  if (req.query.entity_id) { params.push(req.query.entity_id); filters.push(`entity_id=$${params.length}`); }
  if (req.query.action) { params.push(req.query.action); filters.push(`action=$${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  const result = await req.db(
    `SELECT * FROM cds_audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) FROM cds_audit_log ${where}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));

// ══════════════════════════════════════════════════════════════════════════════
// 16. Activity Feed
// ══════════════════════════════════════════════════════════════════════════════

router.get('/activity', asyncHandler(async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit) || 30);
  const result = await req.db(
    `SELECT * FROM cds_audit_log ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  res.json({ data: result.rows });
}));

// ══════════════════════════════════════════════════════════════════════════════
// 17. GPS History
// ══════════════════════════════════════════════════════════════════════════════

router.get('/gps/:vehicleId', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query);
  const filters = ['vehicle_id=$1'];
  const params = [req.params.vehicleId];
  if (req.query.from) { params.push(req.query.from); filters.push(`recorded_at >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); filters.push(`recorded_at <= $${params.length}`); }
  params.push(limit, offset);
  const result = await req.db(
    `SELECT * FROM cds_gps_points WHERE ${filters.join(' AND ')} ORDER BY recorded_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) FROM cds_gps_points WHERE ${filters.join(' AND ')}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));

router.post('/gps', asyncHandler(async (req, res) => {
  const { vehicle_id, lat, lng, speed, heading, altitude, accuracy } = req.body;
  if (!vehicle_id || lat == null || lng == null) return res.status(400).json({ error: 'vehicle_id, lat, lng required' });
  const result = await req.db(
    `INSERT INTO cds_gps_points (vehicle_id, lat, lng, speed, heading, altitude, accuracy, org_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [vehicle_id, lat, lng, speed || null, heading || null, altitude || null, accuracy || null, req.user.org_id]
  );
  res.status(201).json({ data: result.rows[0] });
}));

module.exports = router;
