const Joi = require('joi');
const { pool, query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const { isCfoModuleEnabled } = require('../utils/cfoFlag');
const logger = require('../utils/logger');

function gAudit(actor_id, action, target_type, target_id, payload, ip) {
  query(
    `INSERT INTO guardian_audit_log
       (actor_type, actor_id, action, target_type, target_id, payload, ip_address)
     VALUES ('user',$1,$2,$3,$4,$5,$6)`,
    [actor_id || null, action, target_type || null, target_id || null,
      payload ? JSON.stringify(payload) : null, ip || null]
  ).catch((err) => logger.error(`gAudit error: ${err.message}`));
}

const truckSchema = Joi.object({
  vehicle_id: Joi.string().uuid().allow('', null).optional(),
  driver_name: Joi.string().min(1).max(100).required(),
  driver_phone: Joi.string().max(30).allow('', null),
  driver_license_no: Joi.string().max(50).allow('', null),
  position: Joi.number().integer().min(1).max(6).required(),
});

const cfoInputSchema = Joi.object({
  cfo_user_id: Joi.string().uuid().required(),
  guardian_device_id: Joi.string().uuid().allow(null),
  assigned_truck_positions: Joi.array()
    .items(Joi.number().integer().min(1).max(6))
    .min(1).max(2).required(),
});

const createSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  region: Joi.string().valid('Kenya', 'DRC', 'Tanzania', 'Mali', 'Nigeria', 'Ethiopia', 'Uganda', 'Sudan').required(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
  description: Joi.string().max(500).allow('', null),
  timezone: Joi.string().max(50).default('UTC'),
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  seal_count_per_truck: Joi.number().integer().min(1).max(6).default(3),
  route_origin: Joi.string().max(100).required(),
  route_destination: Joi.string().max(100).required(),
  trucks: Joi.array().items(truckSchema).min(1).max(6).required(),
  cfos: Joi.array().items(cfoInputSchema).min(1).required(),
});

function validateCoverage(trucks, cfos) {
  const truckPositions = new Set(trucks.map((t) => t.position));

  if (truckPositions.size !== trucks.length) {
    return { error: 'duplicate_truck_position' };
  }

  const positionToCfo = new Map();
  for (const cfo of cfos) {
    for (const pos of cfo.assigned_truck_positions) {
      if (!truckPositions.has(pos)) {
        return { error: 'invalid_position_in_cfo_assignment', detail: { position: pos, cfo_user_id: cfo.cfo_user_id } };
      }
      if (positionToCfo.has(pos)) {
        return { error: 'truck_covered_by_multiple_cfos', detail: { position: pos } };
      }
      positionToCfo.set(pos, cfo.cfo_user_id);
    }
  }

  for (const pos of truckPositions) {
    if (!positionToCfo.has(pos)) {
      return { error: 'truck_uncovered_by_cfo', detail: { position: pos } };
    }
  }

  return null;
}

// B1 — create convoy with trucks + CFOs
const createConvoyCfo = asyncHandler(async (req, res) => {
  if (!await isCfoModuleEnabled()) {
    return res.status(403).json({ error: 'cfo_module_disabled' });
  }

  const { error, value } = createSchema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.message });

  const coverageErr = validateCoverage(value.trucks, value.cfos);
  if (coverageErr) return res.status(422).json(coverageErr);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cfoIds = [...new Set(value.cfos.map((c) => c.cfo_user_id))];
    const cfoCheck = await client.query(
      `SELECT id, role FROM users WHERE id = ANY($1) AND deleted_at IS NULL`,
      [cfoIds]
    );
    const foundIds = new Map(cfoCheck.rows.map((r) => [r.id, r.role]));
    for (const id of cfoIds) {
      if (!foundIds.has(id)) {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'cfo_user_not_found', detail: { cfo_user_id: id } });
      }
      if (foundIds.get(id) !== 'cfo') {
        await client.query('ROLLBACK');
        return res.status(422).json({ error: 'cfo_user_wrong_role', detail: { user_id: id, role: foundIds.get(id) } });
      }
    }

    const convoyResult = await client.query(
      `INSERT INTO convoys
         (name, region, priority, description, route_origin, route_destination,
          timezone, start_date, end_date, seal_count_per_truck, status, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planned',$11,NOW(),NOW())
       RETURNING *`,
      [value.name, value.region, value.priority, value.description || null,
        value.route_origin, value.route_destination,
        value.timezone, value.start_date, value.end_date,
        value.seal_count_per_truck, req.user.id]
    );
    const convoy = convoyResult.rows[0];

    const positionToTruckId = new Map();
    for (const truck of value.trucks) {
      const tr = await client.query(
        `INSERT INTO convoy_trucks
           (convoy_id, vehicle_id, driver_name, driver_phone, driver_license_no, position)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, position`,
        [convoy.id, truck.vehicle_id, truck.driver_name,
          truck.driver_phone || null, truck.driver_license_no || null, truck.position]
      );
      positionToTruckId.set(truck.position, tr.rows[0].id);
    }

    for (const cfo of value.cfos) {
      await client.query(
        `INSERT INTO convoy_cfos (convoy_id, cfo_user_id, guardian_device_id)
         VALUES ($1,$2,$3)`,
        [convoy.id, cfo.cfo_user_id, cfo.guardian_device_id || null]
      );
      for (const pos of cfo.assigned_truck_positions) {
        await client.query(
          `INSERT INTO convoy_cfo_truck_assignments (convoy_id, cfo_user_id, convoy_truck_id)
           VALUES ($1,$2,$3)`,
          [convoy.id, cfo.cfo_user_id, positionToTruckId.get(pos)]
        );
      }
    }

    await client.query('COMMIT');

    gAudit(req.user.id, 'convoy_created', 'convoy', convoy.id, { name: convoy.name }, req.ip);

    const io = req.app.get('io');
    if (io) io.emit('convoy:created', { convoyId: convoy.id });

    res.status(201).json({ data: convoy });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message?.includes('convoy_truck_limit_exceeded')) {
      return res.status(422).json({ error: 'convoy_truck_limit_exceeded' });
    }
    throw err;
  } finally {
    client.release();
  }
});

// B2 — add truck to planned convoy
const addTruck = asyncHandler(async (req, res) => {
  if (!await isCfoModuleEnabled()) return res.status(403).json({ error: 'cfo_module_disabled' });

  const schema = Joi.object({
    vehicle_id: Joi.string().uuid().allow('', null).optional(),
    driver_name: Joi.string().min(1).max(100).required(),
    driver_phone: Joi.string().max(30).allow('', null),
    driver_license_no: Joi.string().max(50).allow('', null),
    position: Joi.number().integer().min(1).max(6).required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const convoy = await query(
    'SELECT id, status FROM convoys WHERE id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  if (convoy.rows[0].status !== 'planned') return res.status(422).json({ error: 'convoy_not_in_planned_status' });

  try {
    const result = await query(
      `INSERT INTO convoy_trucks
         (convoy_id, vehicle_id, driver_name, driver_phone, driver_license_no, position)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [req.params.id, value.vehicle_id, value.driver_name,
        value.driver_phone || null, value.driver_license_no || null, value.position]
    );
    gAudit(req.user.id, 'convoy_truck_added', 'convoy_truck', result.rows[0].id, { convoy_id: req.params.id }, req.ip);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'vehicle_or_position_conflict' });
    if (err.message?.includes('convoy_truck_limit_exceeded')) {
      return res.status(422).json({ error: 'convoy_truck_limit_exceeded' });
    }
    throw err;
  }
});

// B2 — remove truck from planned convoy (only if no photos)
const removeTruck = asyncHandler(async (req, res) => {
  if (!await isCfoModuleEnabled()) return res.status(403).json({ error: 'cfo_module_disabled' });

  const convoy = await query(
    'SELECT id, status FROM convoys WHERE id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  if (convoy.rows[0].status !== 'planned') return res.status(422).json({ error: 'convoy_not_in_planned_status' });

  const truck = await query(
    'SELECT id FROM convoy_trucks WHERE id = $1 AND convoy_id = $2',
    [req.params.truckId, req.params.id]
  );
  if (!truck.rows.length) return res.status(404).json({ error: 'Truck not found in convoy' });

  const photos = await query(
    'SELECT id FROM convoy_truck_photos WHERE convoy_truck_id = $1 LIMIT 1',
    [req.params.truckId]
  );
  if (photos.rows.length) return res.status(422).json({ error: 'truck_has_photos_cannot_remove' });

  await query('DELETE FROM convoy_trucks WHERE id = $1', [req.params.truckId]);

  gAudit(req.user.id, 'convoy_truck_removed', 'convoy_truck', req.params.truckId, { convoy_id: req.params.id }, req.ip);
  res.json({ message: 'Truck removed from convoy' });
});

// B2 — add CFO to planned convoy
const addCfo = asyncHandler(async (req, res) => {
  if (!await isCfoModuleEnabled()) return res.status(403).json({ error: 'cfo_module_disabled' });

  const schema = Joi.object({
    cfo_user_id: Joi.string().uuid().required(),
    guardian_device_id: Joi.string().uuid().allow(null),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const convoy = await query(
    'SELECT id, status FROM convoys WHERE id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  if (convoy.rows[0].status !== 'planned') return res.status(422).json({ error: 'convoy_not_in_planned_status' });

  const user = await query(
    'SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL',
    [value.cfo_user_id]
  );
  if (!user.rows.length) return res.status(422).json({ error: 'cfo_user_not_found' });
  if (user.rows[0].role !== 'cfo') return res.status(422).json({ error: 'cfo_user_wrong_role' });

  try {
    const result = await query(
      `INSERT INTO convoy_cfos (convoy_id, cfo_user_id, guardian_device_id)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [req.params.id, value.cfo_user_id, value.guardian_device_id || null]
    );
    gAudit(req.user.id, 'convoy_cfo_added', 'convoy_cfo', result.rows[0].id, { convoy_id: req.params.id }, req.ip);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'cfo_already_in_convoy' });
    throw err;
  }
});

// B2 — remove CFO from planned convoy (only if no assignments)
const removeCfo = asyncHandler(async (req, res) => {
  if (!await isCfoModuleEnabled()) return res.status(403).json({ error: 'cfo_module_disabled' });

  const convoy = await query(
    'SELECT id, status FROM convoys WHERE id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  if (convoy.rows[0].status !== 'planned') return res.status(422).json({ error: 'convoy_not_in_planned_status' });

  const cfoEntry = await query(
    'SELECT id, cfo_user_id FROM convoy_cfos WHERE id = $1 AND convoy_id = $2',
    [req.params.cfoId, req.params.id]
  );
  if (!cfoEntry.rows.length) return res.status(404).json({ error: 'CFO not found in convoy' });

  const assignments = await query(
    `SELECT id FROM convoy_cfo_truck_assignments
     WHERE convoy_id = $1 AND cfo_user_id = $2 LIMIT 1`,
    [req.params.id, cfoEntry.rows[0].cfo_user_id]
  );
  if (assignments.rows.length) {
    return res.status(422).json({ error: 'cfo_has_truck_assignments_cannot_remove' });
  }

  await query('DELETE FROM convoy_cfos WHERE id = $1', [req.params.cfoId]);

  gAudit(req.user.id, 'convoy_cfo_removed', 'convoy_cfo', req.params.cfoId, { convoy_id: req.params.id }, req.ip);
  res.json({ message: 'CFO removed from convoy' });
});

// B2 — assign truck to CFO within planned convoy
const assignTruckToCfo = asyncHandler(async (req, res) => {
  if (!await isCfoModuleEnabled()) return res.status(403).json({ error: 'cfo_module_disabled' });

  const schema = Joi.object({
    cfo_user_id: Joi.string().uuid().required(),
    convoy_truck_id: Joi.string().uuid().required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const convoy = await query(
    'SELECT id, status FROM convoys WHERE id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  if (convoy.rows[0].status !== 'planned') return res.status(422).json({ error: 'convoy_not_in_planned_status' });

  const [truck, cfo] = await Promise.all([
    query('SELECT id FROM convoy_trucks WHERE id = $1 AND convoy_id = $2', [value.convoy_truck_id, req.params.id]),
    query('SELECT id FROM convoy_cfos WHERE cfo_user_id = $1 AND convoy_id = $2', [value.cfo_user_id, req.params.id]),
  ]);
  if (!truck.rows.length) return res.status(404).json({ error: 'truck_not_found_in_convoy' });
  if (!cfo.rows.length) return res.status(422).json({ error: 'cfo_not_in_convoy' });

  try {
    const result = await query(
      `INSERT INTO convoy_cfo_truck_assignments (convoy_id, cfo_user_id, convoy_truck_id)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [req.params.id, value.cfo_user_id, value.convoy_truck_id]
    );
    gAudit(req.user.id, 'convoy_cfo_assignment_added', 'convoy_cfo_truck_assignment',
      result.rows[0].id, { convoy_id: req.params.id }, req.ip);
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.message?.includes('cfo_truck_limit_exceeded')) {
      return res.status(422).json({ error: 'cfo_truck_limit_exceeded' });
    }
    if (err.code === '23505') return res.status(409).json({ error: 'assignment_already_exists' });
    throw err;
  }
});

// B2 — remove a truck-to-CFO assignment
const removeAssignment = asyncHandler(async (req, res) => {
  if (!await isCfoModuleEnabled()) return res.status(403).json({ error: 'cfo_module_disabled' });

  const convoy = await query(
    'SELECT id, status FROM convoys WHERE id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  if (convoy.rows[0].status !== 'planned') return res.status(422).json({ error: 'convoy_not_in_planned_status' });

  const assignment = await query(
    'SELECT id FROM convoy_cfo_truck_assignments WHERE id = $1 AND convoy_id = $2',
    [req.params.assignmentId, req.params.id]
  );
  if (!assignment.rows.length) return res.status(404).json({ error: 'Assignment not found' });

  await query('DELETE FROM convoy_cfo_truck_assignments WHERE id = $1', [req.params.assignmentId]);

  gAudit(req.user.id, 'convoy_cfo_assignment_removed', 'convoy_cfo_truck_assignment',
    req.params.assignmentId, { convoy_id: req.params.id }, req.ip);
  res.json({ message: 'Assignment removed' });
});

// E5 — list daily reports for a convoy
const getConvoyReports = asyncHandler(async (req, res) => {
  const convoy = await query('SELECT id FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const result = await query(
    `SELECT * FROM convoy_daily_reports
     WHERE convoy_id = $1
     ORDER BY report_date DESC`,
    [req.params.id]
  );
  res.json({ data: result.rows });
});

// E5 — trigger PDF re-generation for a specific date
const regenerateReport = asyncHandler(async (req, res) => {
  const convoy = await query('SELECT id FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  const report = await query(
    'SELECT id FROM convoy_daily_reports WHERE convoy_id = $1 AND report_date = $2',
    [req.params.id, date]
  );
  if (!report.rows.length) return res.status(404).json({ error: 'No report row for this date' });

  // Reset to partial so the worker will regenerate it
  await query(
    `UPDATE convoy_daily_reports SET status = 'partial', pdf_url = NULL, generation_error = NULL, updated_at = NOW()
     WHERE convoy_id = $1 AND report_date = $2`,
    [req.params.id, date]
  );

  try {
    const { getQueues } = require('../config/queue');
    const { convoyReportQueue } = getQueues();
    if (convoyReportQueue) {
      await convoyReportQueue.add('generateReport', { convoy_id: req.params.id, report_date: date },
        { removeOnComplete: { count: 200 } });
    }
  } catch {}

  gAudit(req.user.id, 'convoy_report_regenerated', 'convoy_daily_report', report.rows[0].id,
    { convoy_id: req.params.id, date }, req.ip);
  res.json({ message: 'Report regeneration queued' });
});

module.exports = {
  createConvoyCfo,
  addTruck,
  removeTruck,
  addCfo,
  removeCfo,
  assignTruckToCfo,
  removeAssignment,
  getConvoyReports,
  regenerateReport,
};
