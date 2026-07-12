const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const { publish } = require('../realtime/centrifugo');

const VALID_TRANSITIONS = {
  planned: ['active', 'cancelled'],
  active: ['completing', 'completed', 'aborted', 'cancelled'],
  completing: ['completed', 'aborted', 'cancelled'],
  completed: [],
  aborted: [],
  cancelled: [],
};

const convoySchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  region: Joi.string().valid('Kenya', 'DRC', 'Tanzania', 'Mali').required(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
  description: Joi.string().max(500).allow('', null),
  departureTime: Joi.date().iso().allow(null),
  estimatedArrival: Joi.date().iso().allow(null),
  routeOrigin: Joi.string().max(100).required(),
  routeDestination: Joi.string().max(100).required(),
  clientId: Joi.string().uuid().allow('', null),
});

// Confirms a client belongs to the requesting org before it's attached to a
// convoy — cargo_clients has no direct org check at the DB layer here since
// this runs through the raw (unscoped) query() helper, not req.db/RLS.
async function assertClientInOrg(clientId, orgId) {
  if (!clientId) return true;
  const result = await query(
    'SELECT id FROM cargo_clients WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
    [clientId, orgId]
  );
  return result.rows.length > 0;
}

function buildPagination(page, limit, total) {
  return { page: parseInt(page), limit: parseInt(limit), totalCount: parseInt(total), totalPages: Math.ceil(total / limit) };
}

const getConvoys = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const filters = [], params = [req.user.org_id];

  if (req.query.status) { params.push(req.query.status); filters.push(`c.status = $${params.length}`); }
  if (req.query.region) { params.push(req.query.region); filters.push(`c.region = $${params.length}`); }
  if (req.query.priority) { params.push(req.query.priority); filters.push(`c.priority = $${params.length}`); }
  if (req.query.clientId) { params.push(req.query.clientId); filters.push(`c.client_id = $${params.length}`); }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const countResult = await query(`SELECT COUNT(*) FROM convoys c WHERE c.org_id = $1 AND c.deleted_at IS NULL ${where}`, params);

  params.push(limit, offset);
  const result = await query(
    `SELECT c.*,
            u.name AS created_by_name,
            cl.name AS client_name,
            cl.company AS client_company,
            COUNT(DISTINCT ca.vehicle_id) AS vehicle_count,
            (SELECT COUNT(*) FROM alerts a WHERE a.convoy_id = c.id AND a.resolved_at IS NULL) AS open_alert_count,
            (SELECT COUNT(*) FROM incidents i WHERE i.convoy_id = c.id AND i.status NOT IN ('resolved','closed')) AS open_incident_count
     FROM convoys c
     LEFT JOIN users u ON u.id = c.created_by
     LEFT JOIN cargo_clients cl ON cl.id = c.client_id
     LEFT JOIN convoy_assignments ca ON ca.convoy_id = c.id
     WHERE c.org_id = $1 AND c.deleted_at IS NULL ${where}
     GROUP BY c.id, u.name, cl.name, cl.company
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ data: result.rows, pagination: buildPagination(page, limit, countResult.rows[0].count) });
});

const getConvoy = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.*, u.name AS created_by_name, cl.name AS client_name, cl.company AS client_company,
            (SELECT COUNT(*) FROM alerts a WHERE a.convoy_id = c.id AND a.resolved_at IS NULL) AS open_alert_count,
            (SELECT COUNT(*) FROM incidents i WHERE i.convoy_id = c.id AND i.status NOT IN ('resolved','closed')) AS open_incident_count
     FROM convoys c
     LEFT JOIN users u ON u.id = c.created_by
     LEFT JOIN cargo_clients cl ON cl.id = c.client_id
     WHERE c.id = $1 AND c.org_id = $2 AND c.deleted_at IS NULL`,
    [req.params.id, req.user.org_id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const [vehicles, trucks, cfos, assignments] = await Promise.all([
    query(
      `SELECT v.*, ca.role AS assignment_role, ca.joined_at
       FROM convoy_assignments ca
       JOIN vehicles v ON v.id = ca.vehicle_id AND v.deleted_at IS NULL
       WHERE ca.convoy_id = $1`,
      [req.params.id]
    ),
    query(
      `SELECT * FROM convoy_trucks WHERE convoy_id = $1 ORDER BY position`,
      [req.params.id]
    ),
    query(
      `SELECT cc.*, u.name AS cfo_name, u.email AS cfo_email
       FROM convoy_cfos cc
       JOIN users u ON u.id = cc.cfo_user_id
       WHERE cc.convoy_id = $1`,
      [req.params.id]
    ),
    query(
      `SELECT * FROM convoy_cfo_truck_assignments WHERE convoy_id = $1`,
      [req.params.id]
    ),
  ]);

  res.json({
    data: {
      ...result.rows[0],
      vehicles: vehicles.rows,
      trucks: trucks.rows,
      cfos: cfos.rows,
      cfo_truck_assignments: assignments.rows,
    },
  });
});

const createConvoy = asyncHandler(async (req, res) => {
  const { error, value } = convoySchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const clientId = value.clientId || null;
  if (clientId && !(await assertClientInOrg(clientId, req.user.org_id))) {
    return res.status(422).json({ error: 'client_not_found' });
  }

  const result = await query(
    `INSERT INTO convoys
       (name, region, priority, description, departure_time, estimated_arrival,
        route_origin, route_destination, client_id, status, created_by, org_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planned',$10,$11,NOW(),NOW())
     RETURNING *`,
    [value.name, value.region, value.priority, value.description || null,
     value.departureTime || null, value.estimatedArrival || null,
     value.routeOrigin, value.routeDestination, clientId, req.user.id, req.user.org_id]
  );

  req.auditAction = 'INSERT';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];

  res.status(201).json({ data: result.rows[0] });
});

const updateConvoy = asyncHandler(async (req, res) => {
  const before = await query('SELECT * FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL', [req.params.id, req.user.org_id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const { error, value } = convoySchema.fork(Object.keys(convoySchema.describe().keys), (f) => f.optional()).validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const clientId = value.clientId || null;
  if (clientId && !(await assertClientInOrg(clientId, req.user.org_id))) {
    return res.status(422).json({ error: 'client_not_found' });
  }

  const result = await query(
    `UPDATE convoys SET
       name = COALESCE($1, name), region = COALESCE($2, region),
       priority = COALESCE($3, priority), description = COALESCE($4, description),
       departure_time = COALESCE($5, departure_time),
       estimated_arrival = COALESCE($6, estimated_arrival),
       route_origin = COALESCE($7, route_origin),
       route_destination = COALESCE($8, route_destination),
       client_id = COALESCE($9, client_id),
       updated_at = NOW()
     WHERE id = $10 AND org_id = $11 AND deleted_at IS NULL RETURNING *`,
    [value.name, value.region, value.priority, value.description,
     value.departureTime, value.estimatedArrival, value.routeOrigin,
     value.routeDestination, clientId, req.params.id, req.user.org_id]
  );

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = before.rows[0];
  req.auditAfter = result.rows[0];

  res.json({ data: result.rows[0] });
});

const updateConvoyStatus = asyncHandler(async (req, res) => {
  const schema = Joi.object({ status: Joi.string().valid('planned', 'active', 'completing', 'completed', 'aborted', 'cancelled').required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const current = await query('SELECT * FROM convoys WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL', [req.params.id, req.user.org_id]);
  if (!current.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const currentStatus = current.rows[0].status;
  if (!VALID_TRANSITIONS[currentStatus]?.includes(value.status)) {
    return res.status(422).json({
      error: `Invalid status transition: ${currentStatus} → ${value.status}. Allowed: ${VALID_TRANSITIONS[currentStatus].join(', ') || 'none'}`,
    });
  }

  const setDeparture = value.status === 'active';
  const setArrival = value.status === 'completed' || value.status === 'aborted' || value.status === 'cancelled';

  const result = await query(
    `UPDATE convoys SET status = $1, updated_at = NOW()
     ${setDeparture ? ', departure_time = NOW()' : ''}
     ${setArrival ? ', arrival_time = NOW()' : ''}
     WHERE id = $2 RETURNING *`,
    [value.status, req.params.id]
  );

  const eventMap = { active: 'convoy:activated', completing: 'convoy:completing', completed: 'convoy:completed', cancelled: 'convoy:cancelled', aborted: 'convoy:aborted' };
  publish(`org#${req.user.org_id}`, { type: 'convoy.update', convoyId: req.params.id, status: value.status, updatedBy: req.user.id });

  // D4: on completion, enqueue archive PDF generation
  if (value.status === 'completed') {
    try {
      const { getQueues } = require('../config/queue');
      const { convoyArchiveQueue } = getQueues();
      if (convoyArchiveQueue) {
        convoyArchiveQueue.add('generateArchive', { convoy_id: req.params.id },
          { jobId: `archive:${req.params.id}`, removeOnComplete: { count: 100 } }
        ).catch(() => {});
      }
    } catch {}
  }

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = { status: currentStatus };
  req.auditAfter = { status: value.status };

  res.json({ data: result.rows[0] });
});

const assignVehicles = asyncHandler(async (req, res) => {
  const schema = Joi.object({ vehicleIds: Joi.array().items(Joi.string().uuid()).min(1).required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const convoy = await query('SELECT id FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  for (const vid of value.vehicleIds) {
    await query(
      `INSERT INTO convoy_assignments (convoy_id, vehicle_id, role, joined_at)
       VALUES ($1, $2, 'escort', NOW())
       ON CONFLICT (convoy_id, vehicle_id) DO NOTHING`,
      [req.params.id, vid]
    );
    await query(
      'UPDATE vehicles SET assigned_convoy_id = $1, updated_at = NOW() WHERE id = $2',
      [req.params.id, vid]
    );
  }

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditAfter = { assigned_vehicles: value.vehicleIds };

  res.json({ message: `${value.vehicleIds.length} vehicle(s) assigned to convoy` });
});

const deleteConvoy = asyncHandler(async (req, res) => {
  const before = await query('SELECT * FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  await query('UPDATE convoys SET deleted_at = NOW() WHERE id = $1', [req.params.id]);

  req.auditAction = 'DELETE';
  req.auditRecordId = req.params.id;
  req.auditBefore = before.rows[0];

  res.json({ message: 'Convoy deleted' });
});

const getConvoyEvents = asyncHandler(async (req, res) => {
  const alerts = await query(
    `SELECT id, 'alert' AS event_type, type, severity, message, created_at FROM alerts
     WHERE convoy_id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  const incidents = await query(
    `SELECT id, 'incident' AS event_type, title AS type, severity, description AS message, created_at FROM incidents
     WHERE convoy_id = $1`,
    [req.params.id]
  );

  const events = [...alerts.rows, ...incidents.rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ data: events });
});

const PRIORITY_MAP = { standard: 'low', express: 'high', critical: 'critical' };

const dispatchConvoy = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    vehicle_id: Joi.string().uuid().required(),
    driver_id: Joi.string().uuid().required(),
    route_id: Joi.string().allow('', null).optional(),
    priority: Joi.string().valid('standard', 'express', 'critical').required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const vehicle = await query(
    'SELECT registration, region FROM vehicles WHERE id = $1 AND deleted_at IS NULL',
    [value.vehicle_id]
  );
  if (!vehicle.rows.length) return res.status(404).json({ error: 'Vehicle not found' });

  const region = vehicle.rows[0].region || 'Kenya';
  const name = `QD-${vehicle.rows[0].registration}-${Date.now().toString(36).toUpperCase()}`;
  const mappedPriority = PRIORITY_MAP[value.priority];

  const convoy = await query(
    `INSERT INTO convoys
       (name, region, priority, status, route_origin, route_destination, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,'active','Dispatch Point','In Transit',$4,NOW(),NOW())
     RETURNING *`,
    [name, region, mappedPriority, req.user.id]
  );
  const convoyId = convoy.rows[0].id;

  await query(
    `INSERT INTO convoy_assignments (convoy_id, vehicle_id, role, joined_at)
     VALUES ($1,$2,'escort',NOW()) ON CONFLICT (convoy_id, vehicle_id) DO NOTHING`,
    [convoyId, value.vehicle_id]
  );
  await query(
    'UPDATE vehicles SET assigned_convoy_id = $1, updated_at = NOW() WHERE id = $2',
    [convoyId, value.vehicle_id]
  );

  publish(`org#${req.user.org_id}`, { type: 'convoy.dispatched', convoyId, vehicleId: value.vehicle_id, dispatchedBy: req.user.id });

  req.auditAction = 'INSERT';
  req.auditRecordId = convoyId;
  req.auditAfter = convoy.rows[0];

  res.status(201).json({ data: convoy.rows[0] });
});

module.exports = { getConvoys, getConvoy, createConvoy, updateConvoy, updateConvoyStatus, assignVehicles, deleteConvoy, getConvoyEvents, dispatchConvoy };
