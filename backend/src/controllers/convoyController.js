const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');

const VALID_TRANSITIONS = {
  planned: ['active'],
  active: ['completed', 'aborted'],
  completed: [],
  aborted: [],
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
});

function buildPagination(page, limit, total) {
  return { page: parseInt(page), limit: parseInt(limit), totalCount: parseInt(total), totalPages: Math.ceil(total / limit) };
}

const getConvoys = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const filters = [], params = [];

  if (req.query.status) { params.push(req.query.status); filters.push(`c.status = $${params.length}`); }
  if (req.query.region) { params.push(req.query.region); filters.push(`c.region = $${params.length}`); }
  if (req.query.priority) { params.push(req.query.priority); filters.push(`c.priority = $${params.length}`); }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const countResult = await query(`SELECT COUNT(*) FROM convoys c WHERE c.deleted_at IS NULL ${where}`, params);

  params.push(limit, offset);
  const result = await query(
    `SELECT c.*,
            u.name AS created_by_name,
            COUNT(DISTINCT ca.vehicle_id) AS vehicle_count
     FROM convoys c
     LEFT JOIN users u ON u.id = c.created_by
     LEFT JOIN convoy_assignments ca ON ca.convoy_id = c.id
     WHERE c.deleted_at IS NULL ${where}
     GROUP BY c.id, u.name
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ data: result.rows, pagination: buildPagination(page, limit, countResult.rows[0].count) });
});

const getConvoy = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.*, u.name AS created_by_name FROM convoys c
     LEFT JOIN users u ON u.id = c.created_by
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const vehicles = await query(
    `SELECT v.*, ca.role AS assignment_role, ca.joined_at
     FROM convoy_assignments ca
     JOIN vehicles v ON v.id = ca.vehicle_id AND v.deleted_at IS NULL
     WHERE ca.convoy_id = $1`,
    [req.params.id]
  );

  res.json({ data: { ...result.rows[0], vehicles: vehicles.rows } });
});

const createConvoy = asyncHandler(async (req, res) => {
  const { error, value } = convoySchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await query(
    `INSERT INTO convoys
       (name, region, priority, description, departure_time, estimated_arrival,
        route_origin, route_destination, status, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9,NOW(),NOW())
     RETURNING *`,
    [value.name, value.region, value.priority, value.description || null,
     value.departureTime || null, value.estimatedArrival || null,
     value.routeOrigin, value.routeDestination, req.user.id]
  );

  req.auditAction = 'INSERT';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];

  res.status(201).json({ data: result.rows[0] });
});

const updateConvoy = asyncHandler(async (req, res) => {
  const before = await query('SELECT * FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const { error, value } = convoySchema.fork(Object.keys(convoySchema.describe().keys), (f) => f.optional()).validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await query(
    `UPDATE convoys SET
       name = COALESCE($1, name), region = COALESCE($2, region),
       priority = COALESCE($3, priority), description = COALESCE($4, description),
       departure_time = COALESCE($5, departure_time),
       estimated_arrival = COALESCE($6, estimated_arrival),
       route_origin = COALESCE($7, route_origin),
       route_destination = COALESCE($8, route_destination),
       updated_at = NOW()
     WHERE id = $9 AND deleted_at IS NULL RETURNING *`,
    [value.name, value.region, value.priority, value.description,
     value.departureTime, value.estimatedArrival, value.routeOrigin,
     value.routeDestination, req.params.id]
  );

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = before.rows[0];
  req.auditAfter = result.rows[0];

  res.json({ data: result.rows[0] });
});

const updateConvoyStatus = asyncHandler(async (req, res) => {
  const schema = Joi.object({ status: Joi.string().valid('planned', 'active', 'completed', 'aborted').required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const current = await query('SELECT * FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!current.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const currentStatus = current.rows[0].status;
  if (!VALID_TRANSITIONS[currentStatus]?.includes(value.status)) {
    return res.status(422).json({
      error: `Invalid status transition: ${currentStatus} → ${value.status}. Allowed: ${VALID_TRANSITIONS[currentStatus].join(', ') || 'none'}`,
    });
  }

  const setDeparture = value.status === 'active';
  const setArrival = value.status === 'completed' || value.status === 'aborted';

  const result = await query(
    `UPDATE convoys SET status = $1, updated_at = NOW()
     ${setDeparture ? ', departure_time = NOW()' : ''}
     ${setArrival ? ', arrival_time = NOW()' : ''}
     WHERE id = $2 RETURNING *`,
    [value.status, req.params.id]
  );

  const io = req.app.get('io');
  if (io) io.emit('convoy:update', { convoyId: req.params.id, status: value.status, updatedBy: req.user.id });

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

module.exports = { getConvoys, getConvoy, createConvoy, updateConvoy, updateConvoyStatus, assignVehicles, deleteConvoy, getConvoyEvents };
