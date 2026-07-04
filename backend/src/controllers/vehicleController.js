const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');

const vehicleSchema = Joi.object({
  type: Joi.string().valid('SUV', 'Truck', 'APC', 'Motorcycle', 'Van').required(),
  registration: Joi.string().min(3).max(20).required(),
  region: Joi.string().valid('Kenya', 'DRC', 'Tanzania', 'Mali').required(),
  capacity: Joi.number().integer().min(1).max(50).required(),
  driverId: Joi.string().uuid().allow(null),
});

const updateSchema = vehicleSchema.fork(
  ['type', 'registration', 'region', 'capacity'],
  (f) => f.optional()
);

function buildPagination(page, limit, total) {
  return {
    page: parseInt(page),
    limit: parseInt(limit),
    totalCount: parseInt(total),
    totalPages: Math.ceil(total / limit),
  };
}

const getVehicles = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  const filters = [];
  const params = [];

  if (req.query.status) { params.push(req.query.status); filters.push(`v.status = $${params.length}`); }
  if (req.query.region) { params.push(req.query.region); filters.push(`v.region = $${params.length}`); }
  if (req.query.type) { params.push(req.query.type); filters.push(`v.type = $${params.length}`); }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    filters.push(`(v.registration ILIKE $${params.length} OR v.make ILIKE $${params.length} OR v.model ILIKE $${params.length})`);
  }

  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const countResult = await query(
    `SELECT COUNT(*) FROM vehicles v WHERE v.deleted_at IS NULL ${where}`,
    params
  );

  params.push(limit, offset);
  const dataResult = await query(
    `SELECT v.*, u.name AS driver_name, u.email AS driver_email
     FROM vehicles v
     LEFT JOIN users u ON u.id = v.driver_id AND u.deleted_at IS NULL
     WHERE v.deleted_at IS NULL ${where}
     ORDER BY v.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    data: dataResult.rows,
    pagination: buildPagination(page, limit, countResult.rows[0].count),
  });
});

const getVehicle = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT v.*, u.name AS driver_name, u.email AS driver_email,
            c.name AS convoy_name, c.status AS convoy_status
     FROM vehicles v
     LEFT JOIN users u ON u.id = v.driver_id
     LEFT JOIN convoys c ON c.id = v.assigned_convoy_id
     WHERE v.id = $1 AND v.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Vehicle not found' });
  res.json({ data: result.rows[0] });
});

const createVehicle = asyncHandler(async (req, res) => {
  const { error, value } = vehicleSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await query(
    `INSERT INTO vehicles (type, registration, region, capacity, driver_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'idle', NOW(), NOW())
     RETURNING *`,
    [value.type, value.registration, value.region, value.capacity, value.driverId || null]
  );

  req.auditAction = 'INSERT';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];

  res.status(201).json({ data: result.rows[0] });
});

const updateVehicle = asyncHandler(async (req, res) => {
  const before = await query('SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Vehicle not found' });

  const { error, value } = updateSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await query(
    `UPDATE vehicles SET
       type = COALESCE($1, type),
       registration = COALESCE($2, registration),
       region = COALESCE($3, region),
       capacity = COALESCE($4, capacity),
       driver_id = COALESCE($5, driver_id),
       updated_at = NOW()
     WHERE id = $6 AND deleted_at IS NULL
     RETURNING *`,
    [value.type, value.registration, value.region, value.capacity, value.driverId, req.params.id]
  );

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = before.rows[0];
  req.auditAfter = result.rows[0];

  res.json({ data: result.rows[0] });
});

const updateVehicleStatus = asyncHandler(async (req, res) => {
  const schema = Joi.object({ status: Joi.string().valid('idle', 'active', 'maintenance', 'offline').required() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const before = await query('SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Vehicle not found' });

  const result = await query(
    'UPDATE vehicles SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [value.status, req.params.id]
  );

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = { status: before.rows[0].status };
  req.auditAfter = { status: value.status };

  res.json({ data: result.rows[0] });
});

const deleteVehicle = asyncHandler(async (req, res) => {
  const before = await query('SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Vehicle not found' });

  await query('UPDATE vehicles SET deleted_at = NOW() WHERE id = $1', [req.params.id]);

  req.auditAction = 'DELETE';
  req.auditRecordId = req.params.id;
  req.auditBefore = before.rows[0];

  res.json({ message: 'Vehicle deleted' });
});

const getVehicleHistory = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT lat, lng, speed, timestamp FROM gps_logs
     WHERE vehicle_id = $1
     ORDER BY timestamp DESC LIMIT 100`,
    [req.params.id]
  );
  res.json({ data: result.rows });
});

module.exports = {
  getVehicles, getVehicle, createVehicle,
  updateVehicle, updateVehicleStatus, deleteVehicle, getVehicleHistory,
};
