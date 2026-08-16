const router = require('express').Router();
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const requireIdempotencyKey = require('../middleware/idempotency');
const { extractBookingData } = require('../utils/extractionClient');

router.use(authenticate, attachOrgDb);
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

// Yard/port field-crew accounts (see migration 077) are scoped to exactly the
// clamp/unclamp flow — nothing else in this router. Every other route here is
// reachable by any authenticated user (admin/dispatcher/operator/analyst/cfo)
// with no per-route authorize(), so without this check a yard_agent or
// port_agent would inherit that same full CDS surface, defeating the point of
// handing a shared yard/port device a least-privilege login.
const CLAMP_PATH = /^\/bookings\/[^/]+\/containers\/[^/]+\/clamp$/;
const UNCLAMP_PATH = /^\/bookings\/[^/]+\/containers\/[^/]+\/unclamp$/;
// The Yard app's container-pick screen (YardApp.tsx ContainerPick) lists a
// chosen booking's containers before clamping one — GET only, so listing
// stays read-only and adding/editing containers on that same path (POST)
// is still out of reach.
const BOOKING_CONTAINERS_LIST_PATH = /^\/bookings\/[^/]+\/containers$/;
router.use((req, res, next) => {
  const role = req.user.role;
  if (role !== 'yard_agent' && role !== 'port_agent') return next();

  const allowed = role === 'yard_agent'
    ? (req.path === '/field/yard-queue' || CLAMP_PATH.test(req.path)
       || (req.method === 'GET' && BOOKING_CONTAINERS_LIST_PATH.test(req.path)))
    : (req.path === '/field/port-queue' || UNCLAMP_PATH.test(req.path));

  if (!allowed) {
    return res.status(403).json({
      error: 'field_role_restricted',
      message: `${role === 'yard_agent' ? 'Yard' : 'Port'} field accounts can only use the ${role === 'yard_agent' ? 'clamp' : 'unclamp'} flow.`,
    });
  }
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

async function listRows(req, res, table, { joins = '', selectCols = '*', searchCols = [], extraFilters = [], softDelete = true } = {}) {
  const { limit, offset } = paginate(req.query);
  const filters = softDelete ? ['t.deleted_at IS NULL', ...extraFilters] : [...extraFilters];
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
  const where = filters.length ? filters.join(' AND ') : 'TRUE';
  params.push(limit, offset);
  const result = await req.db(
    `SELECT ${selectCols} FROM ${table} t ${joins} WHERE ${where} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) FROM ${table} t ${joins} WHERE ${where}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}

async function getRow(req, res, table, { joins = '', selectCols = '*', softDelete = true } = {}) {
  const cond = softDelete ? 'AND t.deleted_at IS NULL' : '';
  const result = await req.db(
    `SELECT ${selectCols} FROM ${table} t ${joins} WHERE t.id=$1 ${cond}`, [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ data: result.rows[0] });
}

async function createRow(req, res, table, fields, { genField, genPrefix } = {}) {
  const cols = [...fields];
  const vals = cols.map(f => req.body[f] ?? null);
  if (genField) { cols.unshift(genField); vals.unshift(genCode(genPrefix)); }
  cols.push('org_id');
  vals.push(req.user.org_id);
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
  const result = await req.db(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders}) RETURNING *`, vals
  );
  res.status(201).json({ data: result.rows[0] });
}

async function updateRow(req, res, table, fields, { softDelete = true, hasUpdatedAt = true } = {}) {
  const sets = [];
  const params = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); }
  });
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  if (hasUpdatedAt) sets.push('updated_at=NOW()');
  params.push(req.params.id);
  const cond = softDelete ? 'AND deleted_at IS NULL' : '';
  const result = await req.db(
    `UPDATE ${table} SET ${sets.join(',')} WHERE id=$${params.length} ${cond} RETURNING *`, params
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ data: result.rows[0] });
}

// ══════════════════════════════════════════════════════════════
// 1. Dashboard
// ══════════════════════════════════════════════════════════════

router.get('/dashboard', asyncHandler(async (req, res) => {
  const kpis = await req.db(`
    SELECT
      (SELECT COUNT(*) FROM cds_containers WHERE deleted_at IS NULL) AS active_containers,
      (SELECT COUNT(*) FROM cds_trips WHERE status='dispatched' AND deleted_at IS NULL) AS in_transit,
      (SELECT COUNT(*) FROM cds_trips WHERE status='delivered' AND delivered_at::date=CURRENT_DATE AND deleted_at IS NULL) AS delivered_today,
      (SELECT COUNT(*) FROM cds_electronic_locks WHERE status IN ('assigned','installed') AND deleted_at IS NULL) AS active_locks,
      (SELECT COUNT(*) FROM cds_electronic_locks WHERE status='removed' AND deleted_at IS NULL) AS locks_removed,
      (SELECT COUNT(*) FROM cds_trips WHERE status='lock_removed' AND deleted_at IS NULL) AS pending_unclamp,
      (SELECT COUNT(*) FROM cds_trips WHERE status='delayed' AND deleted_at IS NULL) AS delayed_trips,
      (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - departed_at))/3600)::numeric,1) FROM cds_trips WHERE delivered_at IS NOT NULL AND departed_at IS NOT NULL AND deleted_at IS NULL) AS avg_transit_hours
  `);
  const activity = await req.db(
    `SELECT * FROM cds_activity_feed ORDER BY created_at DESC LIMIT 20`
  );
  res.json({ data: { ...kpis.rows[0], recent_activity: activity.rows } });
}));

// ══════════════════════════════════════════════════════════════
// 2. Trips
// ══════════════════════════════════════════════════════════════

const TRIP_JOINS = `LEFT JOIN cds_customers cu ON cu.id=t.customer_id
  LEFT JOIN cds_drivers dr ON dr.id=t.driver_id
  LEFT JOIN cds_vehicles ve ON ve.id=t.vehicle_id`;
const TRIP_COLS = `t.*, t.trip_number AS reference, cu.company_name AS customer_name, dr.name AS "driverName", ve.registration AS "vehicleReg"`;

router.get('/trips', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_trips', {
    joins: TRIP_JOINS, selectCols: TRIP_COLS,
    searchCols: ['t.trip_number', 'cu.company_name', 'dr.name'],
  });
}));

router.get('/trips/:id', asyncHandler(async (req, res) => {
  await getRow(req, res, 'cds_trips', { joins: TRIP_JOINS, selectCols: TRIP_COLS });
}));

router.post('/trips', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_trips',
    ['customer_id', 'driver_id', 'vehicle_id', 'container_id', 'lock_id', 'transporter_id',
     'origin', 'destination', 'eta', 'commodity', 'weight_kg', 'seal_number', 'notes', 'booking_id'],
    { genField: 'trip_number', genPrefix: 'CDS' }
  );
}));

router.patch('/trips/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_trips',
    ['customer_id', 'driver_id', 'vehicle_id', 'container_id', 'lock_id', 'transporter_id',
     'origin', 'destination', 'eta', 'commodity', 'weight_kg', 'seal_number', 'notes', 'risk', 'progress', 'booking_id']
  );
}));

const TRIP_TRANSITIONS = {
  created:           ['vehicle_assigned', 'driver_assigned'],
  vehicle_assigned:  ['driver_assigned', 'awaiting_lock'],
  driver_assigned:   ['vehicle_assigned', 'awaiting_lock'],
  awaiting_lock:     ['locked'],
  locked:            ['dispatched'],
  dispatched:        ['checkpoint', 'delayed', 'at_port', 'delivered'],
  checkpoint:        ['dispatched', 'delayed', 'at_port', 'delivered'],
  delayed:           ['dispatched', 'checkpoint'],
  at_port:           ['delivered'],
  delivered:         ['lock_removed'],
  lock_removed:      ['completed'],
  completed:         ['archived'],
  archived:          [],
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

  const extra = to_status === 'dispatched' ? ', departed_at=NOW()' : to_status === 'delivered' ? ', delivered_at=NOW()' : '';
  const result = await req.db(
    `UPDATE cds_trips SET status=$1, notes=COALESCE($2,notes)${extra}, updated_at=NOW() WHERE id=$3 RETURNING *`,
    [to_status, notes || null, req.params.id]
  );

  await req.db(
    `INSERT INTO cds_audit_logs (action, entity_type, entity_id, user_id, user_name, before_data, after_data, org_id)
     VALUES ('transition','trip',$1,$2,$3,$4,$5,$6)`,
    [req.params.id, req.user.id, req.user.name || null,
     JSON.stringify({ status: current.rows[0].status }),
     JSON.stringify({ status: to_status, notes, lat, lng }),
     req.user.org_id]
  );

  res.json({ data: result.rows[0] });
}));

// ══════════════════════════════════════════════════════════════
// 3. Containers
// ══════════════════════════════════════════════════════════════

router.get('/containers', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_containers', { searchCols: ['t.number', 't.container_type'] });
}));
router.get('/containers/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_containers'); }));
router.post('/containers', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_containers',
    ['number', 'iso_type', 'container_type', 'container_size', 'ownership', 'max_weight_kg', 'tare_weight_kg', 'manufacturer', 'year_built', 'condition', 'status']);
}));
router.patch('/containers/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_containers',
    ['number', 'iso_type', 'container_type', 'container_size', 'ownership', 'max_weight_kg', 'tare_weight_kg', 'condition', 'current_location', 'status']);
}));

// ══════════════════════════════════════════════════════════════
// 4. Electronic Locks
// ══════════════════════════════════════════════════════════════

router.get('/locks', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_electronic_locks', { searchCols: ['t.serial', 't.provider'] });
}));
router.get('/locks/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_electronic_locks'); }));
router.post('/locks', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_electronic_locks',
    ['serial', 'provider', 'firmware_version', 'status', 'battery_level']);
}));
router.patch('/locks/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_electronic_locks',
    ['serial', 'provider', 'firmware_version', 'status', 'battery_level', 'container_id', 'vehicle_id', 'location']);
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
  const { type, lat, lng, data } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });
  const result = await req.db(
    `INSERT INTO cds_lock_events (lock_id, type, lat, lng, data, org_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, type, lat || null, lng || null, JSON.stringify(data || {}), req.user.org_id]
  );
  res.status(201).json({ data: result.rows[0] });
}));

// ══════════════════════════════════════════════════════════════
// 5. Vehicles
// ══════════════════════════════════════════════════════════════

router.get('/vehicles', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_vehicles', { searchCols: ['t.registration', 't.make', 't.model'] });
}));
router.get('/vehicles/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_vehicles'); }));
router.post('/vehicles', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_vehicles',
    ['registration', 'fleet_number', 'vin', 'make', 'model', 'year', 'type', 'fuel_type', 'capacity_kg', 'transporter_id', 'status']);
}));
router.patch('/vehicles/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_vehicles',
    ['registration', 'fleet_number', 'make', 'model', 'year', 'type', 'fuel_type', 'capacity_kg', 'transporter_id', 'current_driver_id', 'status']);
}));

// ══════════════════════════════════════════════════════════════
// 6. Drivers
// ══════════════════════════════════════════════════════════════

router.get('/drivers', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_drivers', { searchCols: ['t.name', 't.phone', 't.license_number'] });
}));
router.get('/drivers/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_drivers'); }));
router.post('/drivers', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_drivers',
    ['name', 'phone', 'email', 'national_id', 'license_number', 'license_expiry', 'transporter_id', 'status']);
}));
router.patch('/drivers/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_drivers',
    ['name', 'phone', 'email', 'national_id', 'license_number', 'license_expiry', 'transporter_id', 'current_vehicle_id', 'status']);
}));

// ══════════════════════════════════════════════════════════════
// 7. Customers
// ══════════════════════════════════════════════════════════════

router.get('/customers', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_customers', { searchCols: ['t.company_name', 't.email', 't.phone'] });
}));
router.get('/customers/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_customers'); }));
router.post('/customers', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_customers',
    ['company_name', 'contact_person', 'phone', 'email', 'address', 'city', 'country', 'status'],
    { genField: 'code', genPrefix: 'CU' });
}));
router.patch('/customers/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_customers',
    ['company_name', 'contact_person', 'phone', 'email', 'address', 'city', 'country', 'status']);
}));

// ══════════════════════════════════════════════════════════════
// 8. Transporters
// ══════════════════════════════════════════════════════════════

router.get('/transporters', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_transporters', { searchCols: ['t.company_name', 't.email', 't.phone'] });
}));
router.get('/transporters/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_transporters'); }));
router.post('/transporters', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_transporters',
    ['company_name', 'contact_person', 'phone', 'email', 'total_trucks', 'status'],
    { genField: 'code', genPrefix: 'TR' });
}));
router.patch('/transporters/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_transporters',
    ['company_name', 'contact_person', 'phone', 'email', 'total_trucks', 'status']);
}));

// ══════════════════════════════════════════════════════════════
// Clamp / Unclamp — ground & port team workflows
// ══════════════════════════════════════════════════════════════

router.post('/trips/:id/clamp', asyncHandler(async (req, res) => {
  const trip = await req.db('SELECT * FROM cds_trips WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
  if (!trip.rows.length) return res.status(404).json({ error: 'Trip not found' });

  const { container_number, lock_serial, host_vehicle, trailer_number,
          driver_name, driver_phone, transporter_name, commodity, seal_number } = req.body;

  const orgId = req.user.org_id;
  let driverId = null, vehicleId = null, containerId = null, lockId = null, transporterId = null;

  if (transporter_name) {
    let tr = await req.db('SELECT id FROM cds_transporters WHERE company_name ILIKE $1 AND deleted_at IS NULL LIMIT 1', [transporter_name.trim()]);
    if (!tr.rows.length) {
      tr = await req.db('INSERT INTO cds_transporters (company_name, code, org_id) VALUES ($1,$2,$3) RETURNING id',
        [transporter_name.trim(), genCode('TR'), orgId]);
    }
    transporterId = tr.rows[0].id;
  }

  if (driver_name) {
    let dr = await req.db('SELECT id FROM cds_drivers WHERE name ILIKE $1 AND deleted_at IS NULL LIMIT 1', [driver_name.trim()]);
    if (!dr.rows.length) {
      dr = await req.db('INSERT INTO cds_drivers (name, phone, transporter_id, org_id) VALUES ($1,$2,$3,$4) RETURNING id',
        [driver_name.trim(), driver_phone || null, transporterId, orgId]);
    }
    driverId = dr.rows[0].id;
  }

  if (host_vehicle) {
    let ve = await req.db('SELECT id FROM cds_vehicles WHERE registration ILIKE $1 AND deleted_at IS NULL LIMIT 1', [host_vehicle.trim()]);
    if (!ve.rows.length) {
      ve = await req.db('INSERT INTO cds_vehicles (registration, fleet_number, transporter_id, org_id) VALUES ($1,$2,$3,$4) RETURNING id',
        [host_vehicle.trim(), genCode('FL'), transporterId, orgId]);
    }
    vehicleId = ve.rows[0].id;
  }

  if (container_number) {
    let co = await req.db('SELECT id FROM cds_containers WHERE number ILIKE $1 AND deleted_at IS NULL LIMIT 1', [container_number.trim()]);
    if (!co.rows.length) {
      co = await req.db('INSERT INTO cds_containers (number, org_id) VALUES ($1,$2) RETURNING id',
        [container_number.trim(), orgId]);
    }
    containerId = co.rows[0].id;
  }

  if (lock_serial) {
    let lk = await req.db('SELECT id FROM cds_electronic_locks WHERE serial ILIKE $1 AND deleted_at IS NULL LIMIT 1', [lock_serial.trim()]);
    if (!lk.rows.length) {
      lk = await req.db('INSERT INTO cds_electronic_locks (serial, provider, org_id) VALUES ($1,$2,$3) RETURNING id',
        [lock_serial.trim(), 'SecuriSat', orgId]);
    }
    lockId = lk.rows[0].id;
    // 'installed' — not 'locked', which isn't a value cds_electronic_locks_status_check
    // allows. Matches the dashboard's active_locks KPI just below (status IN
    // ('assigned','installed')), which already assumed this was the value in use.
    await req.db('UPDATE cds_electronic_locks SET status=$1, container_id=$2, vehicle_id=$3, updated_at=NOW() WHERE id=$4',
      ['installed', containerId, vehicleId, lockId]);
  }

  const trailerNote = trailer_number ? `Trailer: ${trailer_number.trim()}` : null;
  const result = await req.db(
    `UPDATE cds_trips SET status='locked', driver_id=$1, vehicle_id=$2, container_id=$3, lock_id=$4, transporter_id=$5,
     commodity=COALESCE($6, commodity), seal_number=COALESCE($7, seal_number),
     notes=COALESCE($8, notes), updated_at=NOW()
     WHERE id=$9 RETURNING *`,
    [driverId, vehicleId, containerId, lockId, transporterId,
     commodity || null, seal_number || null, trailerNote, req.params.id]
  );

  await req.db(
    `INSERT INTO cds_audit_logs (action, entity_type, entity_id, user_id, user_name, before_data, after_data, org_id)
     VALUES ('clamp','trip',$1,$2,$3,$4,$5,$6)`,
    [req.params.id, req.user.id, req.user.name || null,
     JSON.stringify({ status: trip.rows[0].status }),
     JSON.stringify({ status: 'locked', container_number, lock_serial, host_vehicle, driver_name }),
     orgId]
  );

  res.json({ data: result.rows[0] });
}));

router.post('/trips/:id/unclamp', asyncHandler(async (req, res) => {
  const trip = await req.db('SELECT * FROM cds_trips WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
  if (!trip.rows.length) return res.status(404).json({ error: 'Trip not found' });

  if (trip.rows[0].lock_id) {
    await req.db(
      `UPDATE cds_electronic_locks SET status='available', container_id=NULL, vehicle_id=NULL, updated_at=NOW() WHERE id=$1`,
      [trip.rows[0].lock_id]
    );
  }

  const result = await req.db(
    `UPDATE cds_trips SET status='lock_removed', delivered_at=COALESCE(delivered_at, NOW()), updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [req.params.id]
  );

  await req.db(
    `INSERT INTO cds_audit_logs (action, entity_type, entity_id, user_id, user_name, before_data, after_data, org_id)
     VALUES ('unclamp','trip',$1,$2,$3,$4,$5,$6)`,
    [req.params.id, req.user.id, req.user.name || null,
     JSON.stringify({ status: trip.rows[0].status }),
     JSON.stringify({ status: 'lock_removed', notes: req.body.notes }),
     req.user.org_id]
  );

  res.json({ data: result.rows[0] });
}));

// ══════════════════════════════════════════════════════════════
// 9. Bookings
// ══════════════════════════════════════════════════════════════

router.get('/bookings/pipeline', asyncHandler(async (req, res) => {
  const result = await req.db(`
    SELECT b.*, cu.company_name AS customer_name,
      COUNT(t.id)::int AS trip_count,
      COUNT(t.id) FILTER (WHERE t.status IN ('completed','archived'))::int AS trips_completed,
      CASE
        WHEN b.status IN ('draft','pending') THEN 'received'
        WHEN b.status = 'delivered' THEN 'completed'
        WHEN COUNT(t.id) FILTER (WHERE t.status IN ('delivered','lock_removed','completed')) > 0 THEN 'unclamping'
        WHEN COUNT(t.id) FILTER (WHERE t.status = 'at_port') > 0 THEN 'at_port'
        WHEN COUNT(t.id) FILTER (WHERE t.status IN ('dispatched','checkpoint','delayed')) > 0 THEN 'in_transit'
        WHEN b.status IN ('approved','assigned') THEN 'clamping'
        ELSE 'received'
      END AS pipeline_stage
    FROM cds_bookings b
    LEFT JOIN cds_customers cu ON cu.id = b.customer_id
    LEFT JOIN cds_trips t ON t.booking_id = b.id AND t.deleted_at IS NULL
    WHERE b.deleted_at IS NULL AND b.status != 'cancelled'
    GROUP BY b.id, cu.company_name
    ORDER BY b.created_at DESC
  `);
  res.json({ data: result.rows });
}));

router.get('/bookings', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query);
  const filters = ['t.deleted_at IS NULL'];
  const params = [];
  if (req.query.status) { params.push(req.query.status); filters.push(`t.status=$${params.length}`); }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    filters.push(`(t.booking_number ILIKE $${params.length} OR cu.company_name ILIKE $${params.length})`);
  }
  const where = filters.join(' AND ');
  params.push(limit, offset);
  const result = await req.db(
    `SELECT t.*, cu.company_name AS customer_name,
       COUNT(bc.id)::int AS container_count,
       COUNT(bc.id) FILTER (WHERE bc.status='delivered')::int AS delivered_count
     FROM cds_bookings t
     LEFT JOIN cds_customers cu ON cu.id=t.customer_id
     LEFT JOIN cds_booking_containers bc ON bc.booking_id=t.id AND bc.deleted_at IS NULL
     WHERE ${where}
     GROUP BY t.id, cu.company_name
     ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(
    `SELECT COUNT(DISTINCT t.id) FROM cds_bookings t
     LEFT JOIN cds_customers cu ON cu.id=t.customer_id
     WHERE ${where}`, params.slice(0, -2)
  );
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));
// Container manifest — the yard's working view: one row per container rather
// than per booking, flattened across booking, trip, transporter, vehicle,
// driver and lock so the whole sheet comes back in a single round trip.
//
// Each of the four assignment columns COALESCEs the container's own value over
// the trip-derived one. A container sits clamped in the yard with a driver
// written against it long before a trip exists; once dispatched, the trip is
// the better source. This reads correctly in both states.
//
// Declared before /bookings/:id so Express doesn't match "manifest" as an :id.
router.get('/bookings/manifest', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query);
  const filters = ['bc.deleted_at IS NULL', 'b.deleted_at IS NULL'];
  const params = [];
  // Scope containers explicitly, as the sibling container routes do. The join
  // to cds_bookings already limits rows to this org's bookings via that table's
  // RLS, but that would still surface a container carrying another org's
  // org_id if one were ever attached to this org's booking — and this row
  // carries driver name, contact and lock number. 076 adds the missing policy
  // on cds_booking_containers; this is the belt to that pair of braces.
  params.push(req.user.org_id);
  filters.push(`bc.org_id=$${params.length}`);
  if (req.query.booking_id) { params.push(req.query.booking_id); filters.push(`bc.booking_id=$${params.length}`); }
  if (req.query.yard_status) { params.push(req.query.yard_status); filters.push(`bc.yard_status=$${params.length}`); }
  if (req.query.status) { params.push(req.query.status); filters.push(`bc.status=$${params.length}`); }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    filters.push(`(bc.container_number ILIKE $${params.length} OR bc.seal_number ILIKE $${params.length}
                   OR b.booking_number ILIKE $${params.length} OR b.reference ILIKE $${params.length}
                   OR b.vessel ILIKE $${params.length})`);
  }
  const where = filters.join(' AND ');

  const FROM = `
    FROM cds_booking_containers bc
    JOIN cds_bookings b ON b.id = bc.booking_id
    LEFT JOIN cds_customers cu ON cu.id = b.customer_id
    LEFT JOIN cds_trips t ON t.id = bc.trip_id
    LEFT JOIN cds_transporters tr ON tr.id = t.transporter_id
    LEFT JOIN cds_vehicles v ON v.id = t.vehicle_id
    LEFT JOIN cds_drivers d ON d.id = t.driver_id
    LEFT JOIN cds_electronic_locks el ON el.id = t.lock_id
    WHERE ${where}`;

  params.push(limit, offset);
  const result = await req.db(
    `SELECT bc.id, bc.booking_id, bc.container_number, bc.seal_number, bc.iso_type,
            bc.weight_kg, bc.status, bc.notes,
            bc.clamped_at, bc.unclamped_at, bc.terminal, bc.yard_status, bc.invoiced,
            bc.trailer_reg,
            b.booking_number, b.reference AS file_reference, b.vessel, b.commodity,
            b.controller, cu.company_name AS customer_name,
            t.trip_number, t.status AS trip_status,
            COALESCE(bc.transporter_name, tr.company_name) AS transporter,
            COALESCE(bc.horse_reg,        v.registration)  AS horse_reg,
            COALESCE(bc.driver_name,      d.name)          AS driver_name,
            COALESCE(bc.driver_contact,   d.phone)         AS driver_contact,
            COALESCE(bc.lock_number,      el.serial)       AS lock_number
     ${FROM}
     -- Newest booking first, but a booking's containers stay contiguous and in
     -- container order. Sorting by clamp time instead would scatter the
     -- containers of one booking across the sheet, which is the opposite of how
     -- it gets read — you check a booking's containers together.
     ORDER BY b.created_at DESC, b.booking_number, bc.container_number
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) ${FROM}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));

router.get('/bookings/:id', asyncHandler(async (req, res) => {
  await getRow(req, res, 'cds_bookings', {
    joins: 'LEFT JOIN cds_customers cu ON cu.id=t.customer_id',
    selectCols: 't.*, cu.company_name AS customer_name',
  });
}));
router.post('/bookings/extract',
  require('express').json({ limit: '20mb' }),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const fileData = body.data;
    const mediaType = body.mediaType;
    if (!fileData) {
      return res.status(400).json({ error: 'no_file_data', message: 'No file data received. The upload may be too large or the request was malformed.' });
    }
    try {
      const result = await extractBookingData(fileData, mediaType || 'image/jpeg');
      return res.json(result);
    } catch (err) {
      return res.status(err.allUnconfigured ? 503 : 422).json({
        error: err.allUnconfigured ? 'extraction_not_configured' : 'extraction_failed',
        message: err.message,
        failures: err.failures ?? [],
      });
    }
  }));

router.post('/bookings', asyncHandler(async (req, res) => {
  const { containers, ...body } = req.body;

  // Auto-create customer when user types a name instead of picking from the list
  if (!body.customer_id && body.customer_name) {
    const name = body.customer_name.trim();
    let cu = await req.db(
      'SELECT id FROM cds_customers WHERE company_name ILIKE $1 AND deleted_at IS NULL LIMIT 1', [name]
    );
    if (!cu.rows.length) {
      cu = await req.db(
        `INSERT INTO cds_customers (company_name, contact_person, phone, code, org_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, body.contact_person || name, body.phone || '-', genCode('CU'), req.user.org_id]
      );
    }
    body.customer_id = cu.rows[0].id;
  }

  if (!body.customer_id) return res.status(400).json({ error: 'Customer is required' });

  const fields = ['customer_id', 'pickup_location', 'delivery_location', 'commodity', 'weight_kg',
    'seal_number', 'container_type', 'container_size', 'shipping_line', 'vessel', 'voyage', 'eta', 'reference', 'notes'];
  const cols = ['booking_number', ...fields, 'org_id'];
  const vals = [genCode('BK'), ...fields.map(f => body[f] ?? null), req.user.org_id];
  const phs = vals.map((_, i) => `$${i + 1}`).join(',');
  const bk = await req.db(`INSERT INTO cds_bookings (${cols.join(',')}) VALUES (${phs}) RETURNING *`, vals);
  const booking = bk.rows[0];
  if (Array.isArray(containers) && containers.length > 0) {
    for (const c of containers) {
      await req.db(
        `INSERT INTO cds_booking_containers (org_id, booking_id, container_number, iso_type, seal_number, weight_kg, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.user.org_id, booking.id, c.container_number || null, c.iso_type || '20GP',
         c.seal_number || null, c.weight_kg || null, c.notes || null]
      );
    }
  }
  res.status(201).json({ data: booking });
}));
router.patch('/bookings/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_bookings',
    ['customer_id', 'pickup_location', 'delivery_location', 'commodity', 'weight_kg',
     'container_type', 'container_size', 'shipping_line', 'eta', 'status', 'notes',
     // Manifest columns: vessel and the AW file ref are shown per container row,
     // and the controller owns the booking on the desk.
     'vessel', 'voyage', 'reference', 'controller']
  );
}));

// Booking containers sub-resource
router.get('/bookings/:id/containers', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT bc.*, t.trip_number, t.status AS trip_status
     FROM cds_booking_containers bc
     LEFT JOIN cds_trips t ON t.id = bc.trip_id
     WHERE bc.booking_id=$1 AND bc.org_id=$2 AND bc.deleted_at IS NULL
     ORDER BY bc.created_at`,
    [req.params.id, req.user.org_id]
  );
  res.json({ data: result.rows, total: result.rows.length });
}));
router.post('/bookings/:id/containers', asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const inserted = [];
  for (const c of items) {
    const r = await req.db(
      `INSERT INTO cds_booking_containers (org_id, booking_id, container_number, iso_type, seal_number, weight_kg, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.org_id, req.params.id, c.container_number || null, c.iso_type || '20GP',
       c.seal_number || null, c.weight_kg || null, c.notes || null]
    );
    inserted.push(r.rows[0]);
  }
  res.status(201).json({ data: inserted });
}));
router.patch('/bookings/:id/containers/:cid', asyncHandler(async (req, res) => {
  const allowed = [
    'container_number', 'iso_type', 'seal_number', 'weight_kg', 'notes', 'status',
    // Manifest columns — see 20260807_076_cds_container_ops.sql.
    'clamped_at', 'unclamped_at', 'terminal', 'yard_status', 'invoiced',
    'lock_number', 'transporter_name', 'horse_reg', 'trailer_reg',
    'driver_name', 'driver_contact',
  ];
  const sets = []; const params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${k}=$${params.length}`); }
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
  params.push(req.params.cid, req.user.org_id);
  const r = await req.db(
    `UPDATE cds_booking_containers SET ${sets.join(',')}, updated_at=NOW()
     WHERE id=$${params.length - 1} AND org_id=$${params.length} AND deleted_at IS NULL RETURNING *`,
    params
  );
  if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ data: r.rows[0] });
}));
router.delete('/bookings/:id/containers/:cid', asyncHandler(async (req, res) => {
  await req.db(
    `UPDATE cds_booking_containers SET deleted_at=NOW() WHERE id=$1 AND org_id=$2`,
    [req.params.cid, req.user.org_id]
  );
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════════
// 9b. Field ops — Yard & Port teams (mobile APK)
// ══════════════════════════════════════════════════════════════

// Queue for the Yard team: containers still pending clamp on active bookings.
router.get('/field/yard-queue', asyncHandler(async (req, res) => {
  const result = await req.db(`
    SELECT b.id AS booking_id, b.booking_number, b.pickup_location, b.delivery_location,
           b.commodity, b.shipping_line, b.vessel, b.eta, cu.company_name AS customer_name,
           COUNT(DISTINCT bc.id)::int AS pending_containers,
           COUNT(DISTINCT bc2.id)::int AS total_containers
      FROM cds_bookings b
      LEFT JOIN cds_customers cu ON cu.id = b.customer_id
      LEFT JOIN cds_booking_containers bc  ON bc.booking_id = b.id AND bc.deleted_at IS NULL AND bc.status = 'pending'
      LEFT JOIN cds_booking_containers bc2 ON bc2.booking_id = b.id AND bc2.deleted_at IS NULL
     WHERE b.deleted_at IS NULL
       AND b.status NOT IN ('cancelled','completed','billed')
     GROUP BY b.id, cu.company_name
    -- bc and bc2 are separately-filtered joins to the same table, so any
    -- booking with more than one container in each set fans out into a
    -- cross product of matching rows — plain COUNT(bc.id) then counts each
    -- pending container once per total-container row instead of once.
    HAVING COUNT(DISTINCT bc.id) > 0
     ORDER BY b.eta NULLS LAST, b.created_at DESC
     LIMIT 100
  `);
  res.json({ data: result.rows });
}));

// Queue for the Port team: containers dispatched and heading to / arrived at port.
router.get('/field/port-queue', asyncHandler(async (req, res) => {
  const result = await req.db(`
    SELECT bc.id, bc.container_number, bc.iso_type, bc.seal_number, bc.weight_kg,
           bc.status, bc.updated_at,
           b.id AS booking_id, b.booking_number, b.delivery_location, cu.company_name AS customer_name,
           t.id AS trip_id, t.trip_number, t.status AS trip_status,
           t.departed_at,
           v.registration AS vehicle_reg,
           d.name AS driver_name, d.phone AS driver_phone,
           l.serial AS lock_serial, l.location AS lock_location,
           gps.lat AS last_lat, gps.lng AS last_lng, gps.device_time AS last_seen
      FROM cds_booking_containers bc
      JOIN cds_bookings b ON b.id = bc.booking_id
      LEFT JOIN cds_customers cu ON cu.id = b.customer_id
      LEFT JOIN cds_trips t ON t.id = bc.trip_id AND t.deleted_at IS NULL
      LEFT JOIN cds_vehicles v ON v.id = t.vehicle_id
      LEFT JOIN cds_drivers d ON d.id = t.driver_id
      LEFT JOIN cds_electronic_locks l ON l.id = t.lock_id
      LEFT JOIN LATERAL (
        SELECT lat, lng, device_time
          FROM cds_gps_history
         WHERE vehicle_id = t.vehicle_id
         ORDER BY device_time DESC
         LIMIT 1
      ) gps ON true
     WHERE bc.deleted_at IS NULL
       AND bc.status IN ('assigned','in_transit','at_port')
     ORDER BY bc.updated_at DESC
     LIMIT 200
  `);
  res.json({ data: result.rows });
}));

// Yard team clamps an e-lock onto one container of a booking.
// Auto-creates supporting rows (transporter, driver, vehicle, container, lock, trip)
// so the mobile UI only needs to send free-text names and numbers.
// requireIdempotencyKey is a no-op unless the caller sends x-idempotency-key,
// so nothing changes for the online path. The field app's offline queue does
// send one, and it must: a clamp creates a trip and upserts a driver/vehicle/
// lock, so a queued submission retried after a flaky-network timeout would
// otherwise create a second trip for the same container.
router.post('/bookings/:id/containers/:cid/clamp', requireIdempotencyKey, asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const { id: bookingId, cid: bcId } = req.params;
  const {
    lock_serial, transporter_name, truck_reg, trailer_reg,
    driver_name, driver_phone, notes, lat, lng,
  } = req.body || {};

  if (!lock_serial || !truck_reg || !driver_name) {
    return res.status(400).json({ error: 'lock_serial, truck_reg and driver_name are required' });
  }

  const bc = await req.db(
    `SELECT bc.*, b.booking_number, b.customer_id, b.pickup_location, b.delivery_location
       FROM cds_booking_containers bc
       JOIN cds_bookings b ON b.id = bc.booking_id
      WHERE bc.id=$1 AND bc.booking_id=$2 AND bc.deleted_at IS NULL`,
    [bcId, bookingId]
  );
  if (!bc.rows.length) return res.status(404).json({ error: 'Booking container not found' });
  if (bc.rows[0].status !== 'pending' && bc.rows[0].status !== 'assigned') {
    return res.status(409).json({ error: `Container already ${bc.rows[0].status}` });
  }

  // Upsert transporter. contact_person/phone are NOT NULL on cds_transporters
  // but the clamp form only collects a company name — same fallback the
  // customer auto-create above uses (the name doubles as the placeholder
  // contact until someone fills in the real one from the transporters view).
  let transporterId = null;
  if (transporter_name) {
    const t = await req.db(
      'SELECT id FROM cds_transporters WHERE company_name ILIKE $1 AND deleted_at IS NULL LIMIT 1',
      [transporter_name.trim()]
    );
    if (t.rows.length) transporterId = t.rows[0].id;
    else {
      const ins = await req.db(
        `INSERT INTO cds_transporters (company_name, contact_person, phone, code, org_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [transporter_name.trim(), transporter_name.trim(), '-', genCode('TR'), orgId]
      );
      transporterId = ins.rows[0].id;
    }
  }

  // Upsert driver. license_number/license_expiry are NOT NULL on cds_drivers
  // but the clamp form doesn't collect them — placeholder + a generous expiry
  // so the row is valid until ops backfills the real license from the
  // drivers view; not a compliance record, just enough to satisfy the schema.
  const dr = await req.db(
    'SELECT id FROM cds_drivers WHERE name ILIKE $1 AND deleted_at IS NULL LIMIT 1',
    [driver_name.trim()]
  );
  const driverId = dr.rows.length ? dr.rows[0].id : (await req.db(
    `INSERT INTO cds_drivers (name, phone, license_number, license_expiry, transporter_id, org_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [driver_name.trim(), driver_phone || '-', 'PENDING', new Date(Date.now() + 365 * 24 * 3600 * 1000), transporterId, orgId]
  )).rows[0].id;

  // Upsert vehicle (truck horse)
  const ve = await req.db(
    'SELECT id FROM cds_vehicles WHERE registration ILIKE $1 AND deleted_at IS NULL LIMIT 1',
    [truck_reg.trim()]
  );
  const vehicleId = ve.rows.length ? ve.rows[0].id : (await req.db(
    `INSERT INTO cds_vehicles (registration, fleet_number, transporter_id, org_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    [truck_reg.trim(), genCode('FL'), transporterId, orgId]
  )).rows[0].id;

  // Upsert physical container (in cds_containers) so it can be tracked on the map
  let containerId = null;
  if (bc.rows[0].container_number) {
    const co = await req.db(
      'SELECT id FROM cds_containers WHERE number ILIKE $1 AND deleted_at IS NULL LIMIT 1',
      [bc.rows[0].container_number]
    );
    containerId = co.rows.length ? co.rows[0].id : (await req.db(
      `INSERT INTO cds_containers (number, iso_type, org_id) VALUES ($1,$2,$3) RETURNING id`,
      [bc.rows[0].container_number, bc.rows[0].iso_type || '20GP', orgId]
    )).rows[0].id;
  }

  // Upsert e-lock and put it into 'locked' state on this container/vehicle
  const lk = await req.db(
    'SELECT id FROM cds_electronic_locks WHERE serial ILIKE $1 AND deleted_at IS NULL LIMIT 1',
    [lock_serial.trim()]
  );
  const lockId = lk.rows.length ? lk.rows[0].id : (await req.db(
    `INSERT INTO cds_electronic_locks (serial, provider, status, org_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    [lock_serial.trim(), 'SecuriSat', 'assigned', orgId]
  )).rows[0].id;
  // 'installed', matching cds_electronic_locks_status_check and the desktop
  // clamp handler above — 'locked' isn't a value the constraint allows.
  await req.db(
    `UPDATE cds_electronic_locks SET status='installed', container_id=$1, vehicle_id=$2, updated_at=NOW() WHERE id=$3`,
    [containerId, vehicleId, lockId]
  );

  // Create the trip and link it back to the booking container
  const trailerNote = trailer_reg ? `Trailer: ${trailer_reg.trim()}${notes ? ' | ' + notes : ''}` : (notes || null);
  const trip = await req.db(
    `INSERT INTO cds_trips
      (trip_number, customer_id, driver_id, vehicle_id, container_id, lock_id, transporter_id,
       origin, destination, commodity, seal_number, weight_kg, booking_id, notes, status, org_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'locked',$15) RETURNING *`,
    [
      genCode('CDS'), bc.rows[0].customer_id, driverId, vehicleId, containerId, lockId, transporterId,
      bc.rows[0].pickup_location, bc.rows[0].delivery_location, null, bc.rows[0].seal_number, bc.rows[0].weight_kg,
      bookingId, trailerNote, orgId,
    ]
  );

  await req.db(
    `UPDATE cds_booking_containers
        SET status='in_transit', trip_id=$1, updated_at=NOW()
      WHERE id=$2`,
    [trip.rows[0].id, bcId]
  );

  // Bump booking to 'assigned' if still in draft/pending
  await req.db(
    `UPDATE cds_bookings
        SET status = CASE WHEN status IN ('draft','pending') THEN 'assigned' ELSE status END,
            updated_at = NOW()
      WHERE id=$1`,
    [bookingId]
  );

  // Fire alert so supervisors see it in real-time
  await req.db(
    `INSERT INTO cds_alerts (org_id, type, severity, title, message, entity_type, entity_id, escalation_level)
     VALUES ($1,'container_clamped','info',$2,$3,'container',$4,'operator')`,
    [orgId,
     `Container clamped — ${bc.rows[0].container_number || bc.rows[0].booking_number}`,
     `${req.user.name || 'Yard team'} clamped e-lock ${lock_serial} on ${bc.rows[0].container_number || bcId} for booking ${bc.rows[0].booking_number} (${truck_reg} / ${driver_name}).`,
     bcId]
  );

  await req.db(
    `INSERT INTO cds_audit_logs (action, entity_type, entity_id, user_id, user_name, after_data, org_id)
     VALUES ('clamp','booking_container',$1,$2,$3,$4,$5)`,
    [bcId, req.user.id, req.user.name || null,
     JSON.stringify({ lock_serial, transporter_name, truck_reg, trailer_reg, driver_name, driver_phone, lat, lng }),
     orgId]
  );

  res.json({ data: { trip: trip.rows[0], booking_container_id: bcId } });
}));

// Port team unclamps the e-lock — container has arrived and been delivered.
// Idempotent for the same reason as clamp — see the note there.
router.post('/bookings/:id/containers/:cid/unclamp', requireIdempotencyKey, asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const { id: bookingId, cid: bcId } = req.params;
  const { notes, lat, lng } = req.body || {};

  const bc = await req.db(
    `SELECT bc.*, b.booking_number, t.id AS trip_id, t.lock_id
       FROM cds_booking_containers bc
       JOIN cds_bookings b ON b.id = bc.booking_id
       LEFT JOIN cds_trips t ON t.id = bc.trip_id
      WHERE bc.id=$1 AND bc.booking_id=$2 AND bc.deleted_at IS NULL`,
    [bcId, bookingId]
  );
  if (!bc.rows.length) return res.status(404).json({ error: 'Booking container not found' });
  if (bc.rows[0].status === 'delivered' || bc.rows[0].status === 'completed') {
    return res.status(409).json({ error: 'Container already delivered' });
  }

  const now = new Date();

  if (bc.rows[0].lock_id) {
    await req.db(
      `UPDATE cds_electronic_locks
          SET status='available', container_id=NULL, vehicle_id=NULL, updated_at=NOW()
        WHERE id=$1`,
      [bc.rows[0].lock_id]
    );
  }

  if (bc.rows[0].trip_id) {
    await req.db(
      `UPDATE cds_trips
          SET status='lock_removed', delivered_at=COALESCE(delivered_at, NOW()), updated_at=NOW()
        WHERE id=$1`,
      [bc.rows[0].trip_id]
    );
  }

  await req.db(
    `UPDATE cds_booking_containers
        SET status='delivered', updated_at=$1
      WHERE id=$2`,
    [now, bcId]
  );

  // If every container on the booking is delivered, mark the booking delivered too.
  const remaining = await req.db(
    `SELECT COUNT(*)::int AS c FROM cds_booking_containers
      WHERE booking_id=$1 AND deleted_at IS NULL AND status NOT IN ('delivered','completed')`,
    [bookingId]
  );
  if (remaining.rows[0].c === 0) {
    await req.db(`UPDATE cds_bookings SET status='delivered', updated_at=NOW() WHERE id=$1`, [bookingId]);
  }

  // Notify CDS controllers / supervisors
  await req.db(
    `INSERT INTO cds_alerts (org_id, type, severity, title, message, entity_type, entity_id, escalation_level)
     VALUES ($1,'container_delivered','info',$2,$3,'container',$4,'supervisor')`,
    [orgId,
     `Container unclamped at port — ${bc.rows[0].container_number || bc.rows[0].booking_number}`,
     `${req.user.name || 'Port team'} unclamped container ${bc.rows[0].container_number || bcId} on booking ${bc.rows[0].booking_number} at ${now.toISOString()}.${notes ? ' Notes: ' + notes : ''}`,
     bcId]
  );

  await req.db(
    `INSERT INTO cds_audit_logs (action, entity_type, entity_id, user_id, user_name, after_data, org_id)
     VALUES ('unclamp','booking_container',$1,$2,$3,$4,$5)`,
    [bcId, req.user.id, req.user.name || null,
     JSON.stringify({ notes, lat, lng, unclamped_at: now.toISOString() }),
     orgId]
  );

  res.json({
    data: {
      booking_container_id: bcId, status: 'delivered', unclamped_at: now.toISOString(),
      unclamped_by: req.user.name || req.user.email || 'unknown',
    },
  });
}));

// ══════════════════════════════════════════════════════════════
// 10. Alerts
// ══════════════════════════════════════════════════════════════

router.get('/alerts', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query);
  const filters = [];
  const params = [];
  if (req.query.severity) { params.push(req.query.severity); filters.push(`severity=$${params.length}`); }
  if (req.query.type) { params.push(req.query.type); filters.push(`type=$${params.length}`); }
  if (req.query.acknowledged === 'true') filters.push('acknowledged=true');
  else if (req.query.acknowledged === 'false') filters.push('acknowledged=false');
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  const result = await req.db(
    `SELECT * FROM cds_alerts ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) FROM cds_alerts ${where}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));

router.post('/alerts/:id/acknowledge', asyncHandler(async (req, res) => {
  const result = await req.db(
    `UPDATE cds_alerts SET acknowledged=true, acknowledged_at=NOW(), acknowledged_by=$1
     WHERE id=$2 AND acknowledged=false RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Alert not found or already acknowledged' });
  res.json({ data: result.rows[0] });
}));

// ══════════════════════════════════════════════════════════════
// 11. Incidents
// ══════════════════════════════════════════════════════════════

router.get('/incidents', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_incidents', { searchCols: ['t.incident_number', 't.title'] });
}));
router.get('/incidents/:id', asyncHandler(async (req, res) => { await getRow(req, res, 'cds_incidents'); }));
router.post('/incidents', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_incidents',
    ['trip_id', 'container_id', 'lock_id', 'vehicle_id', 'driver_id',
     'title', 'description', 'severity', 'type', 'assigned_to', 'lat', 'lng'],
    { genField: 'incident_number', genPrefix: 'INC' }
  );
}));
router.patch('/incidents/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_incidents',
    ['title', 'description', 'severity', 'status', 'type', 'assigned_to', 'resolution']
  );
}));

// ══════════════════════════════════════════════════════════════
// 12. Geofences
// ══════════════════════════════════════════════════════════════

router.get('/geofences', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_geofences', { searchCols: ['t.name'] });
}));
router.post('/geofences', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_geofences',
    ['name', 'type', 'category', 'geometry', 'center_lat', 'center_lng', 'radius_m', 'alert_config', 'active']);
}));
router.patch('/geofences/:id', asyncHandler(async (req, res) => {
  await updateRow(req, res, 'cds_geofences',
    ['name', 'type', 'category', 'geometry', 'center_lat', 'center_lng', 'radius_m', 'alert_config', 'active']);
}));
router.delete('/geofences/:id', asyncHandler(async (req, res) => {
  const result = await req.db(
    `UPDATE cds_geofences SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ data: { id: result.rows[0].id, deleted: true } });
}));

// ══════════════════════════════════════════════════════════════
// 13. Documents
// ══════════════════════════════════════════════════════════════

router.get('/documents', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_documents', { searchCols: ['t.name', 't.type'] });
}));
router.post('/documents', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_documents',
    ['name', 'type', 'mime_type', 'file_size', 'storage_key', 'trip_id', 'container_id', 'booking_id', 'uploaded_by']
  );
}));

// ══════════════════════════════════════════════════════════════
// 14. Reports
// ══════════════════════════════════════════════════════════════

router.get('/reports', asyncHandler(async (req, res) => {
  await listRows(req, res, 'cds_reports', { searchCols: ['t.name', 't.type'], softDelete: false });
}));
router.post('/reports', asyncHandler(async (req, res) => {
  await createRow(req, res, 'cds_reports', ['name', 'type', 'format', 'parameters', 'generated_by']);
}));

// ══════════════════════════════════════════════════════════════
// 15. Audit
// ══════════════════════════════════════════════════════════════

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
    `SELECT * FROM cds_audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) FROM cds_audit_logs ${where}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));

// ══════════════════════════════════════════════════════════════
// 16. Activity Feed
// ══════════════════════════════════════════════════════════════

router.get('/activity', asyncHandler(async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit) || 30);
  const result = await req.db(
    `SELECT * FROM cds_activity_feed ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  res.json(result.rows);
}));

// ══════════════════════════════════════════════════════════════
// 17. GPS History
// ══════════════════════════════════════════════════════════════

router.get('/gps/:vehicleId', asyncHandler(async (req, res) => {
  const { limit, offset } = paginate(req.query);
  const filters = ['vehicle_id=$1'];
  const params = [req.params.vehicleId];
  if (req.query.from) { params.push(req.query.from); filters.push(`device_time >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); filters.push(`device_time <= $${params.length}`); }
  params.push(limit, offset);
  const result = await req.db(
    `SELECT * FROM cds_gps_history WHERE ${filters.join(' AND ')} ORDER BY device_time DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  const total = await req.db(`SELECT COUNT(*) FROM cds_gps_history WHERE ${filters.join(' AND ')}`, params.slice(0, -2));
  res.json({ data: result.rows, total: parseInt(total.rows[0].count, 10) });
}));

router.post('/gps', asyncHandler(async (req, res) => {
  const { vehicle_id, trip_id, lat, lng, speed, heading, altitude, ignition, fuel_level, battery, odometer, signal_strength, device_time } = req.body;
  if (!vehicle_id || lat == null || lng == null) return res.status(400).json({ error: 'vehicle_id, lat, lng required' });
  const result = await req.db(
    `INSERT INTO cds_gps_history (vehicle_id, trip_id, lat, lng, speed, heading, altitude, ignition, fuel_level, battery, odometer, signal_strength, device_time, org_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [vehicle_id, trip_id || null, lat, lng, speed || null, heading || null, altitude || null,
     ignition ?? null, fuel_level || null, battery || null, odometer || null, signal_strength || null,
     device_time || new Date().toISOString(), req.user.org_id]
  );
  res.status(201).json({ data: result.rows[0] });
}));

module.exports = router;
