const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');

const alertSchema = Joi.object({
  vehicleId: Joi.string().uuid().required(),
  convoyId: Joi.string().uuid().allow(null),
  type: Joi.string().valid('speed', 'geofence', 'mechanical', 'security', 'communication').required(),
  severity: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
  message: Joi.string().min(5).max(500).required(),
});

const getAlerts = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const filters = [], params = [];

  if (req.query.severity) { params.push(req.query.severity); filters.push(`a.severity = $${params.length}`); }
  if (req.query.resolved === 'false') filters.push('a.resolved_at IS NULL');
  if (req.query.resolved === 'true') filters.push('a.resolved_at IS NOT NULL');

  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const countResult = await query(`SELECT COUNT(*) FROM alerts a WHERE a.deleted_at IS NULL ${where}`, params);

  params.push(limit, offset);
  const result = await query(
    `SELECT a.*, v.registration AS vehicle_reg, v.region, c.name AS convoy_name
     FROM alerts a
     LEFT JOIN vehicles v ON v.id = a.vehicle_id
     LEFT JOIN convoys c ON c.id = a.convoy_id
     WHERE a.deleted_at IS NULL ${where}
     ORDER BY a.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = parseInt(countResult.rows[0].count);
  res.json({ data: result.rows, pagination: { page, limit, totalCount: total, totalPages: Math.ceil(total / limit) } });
});

const getAlert = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM alerts WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Alert not found' });
  res.json({ data: result.rows[0] });
});

const createAlert = asyncHandler(async (req, res) => {
  const { error, value } = alertSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await query(
    `INSERT INTO alerts (vehicle_id, convoy_id, type, severity, message, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *`,
    [value.vehicleId, value.convoyId || null, value.type, value.severity, value.message, req.user.id]
  );

  const io = req.app.get('io');
  if (io) io.emit('alert:new', { alertId: result.rows[0].id, vehicleId: value.vehicleId, type: value.type, severity: value.severity, message: value.message });

  req.auditAction = 'INSERT';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];

  res.status(201).json({ data: result.rows[0] });
});

const acknowledgeAlert = asyncHandler(async (req, res) => {
  const alert = await query('SELECT * FROM alerts WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!alert.rows.length) return res.status(404).json({ error: 'Alert not found' });
  if (alert.rows[0].acknowledged_at) return res.status(409).json({ error: 'Alert already acknowledged' });

  const result = await query(
    'UPDATE alerts SET acknowledged_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
    [req.params.id]
  );

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = { acknowledged_at: null };
  req.auditAfter = { acknowledged_at: result.rows[0].acknowledged_at };

  res.json({ data: result.rows[0] });
});

const resolveAlert = asyncHandler(async (req, res) => {
  const alert = await query('SELECT * FROM alerts WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!alert.rows.length) return res.status(404).json({ error: 'Alert not found' });
  if (!alert.rows[0].acknowledged_at) return res.status(422).json({ error: 'Alert must be acknowledged before resolving' });
  if (alert.rows[0].resolved_at) return res.status(409).json({ error: 'Alert already resolved' });

  const result = await query(
    'UPDATE alerts SET resolved_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
    [req.params.id]
  );

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  req.auditBefore = { resolved_at: null };
  req.auditAfter = { resolved_at: result.rows[0].resolved_at };

  res.json({ data: result.rows[0] });
});

module.exports = { getAlerts, getAlert, createAlert, acknowledgeAlert, resolveAlert };
