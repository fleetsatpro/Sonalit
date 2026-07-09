const path = require('path');
const fs = require('fs');
const Joi = require('joi');
const { pool, query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const { isCfoModuleEnabled } = require('../utils/cfoFlag');
const logger = require('../utils/logger');
const { publish } = require('../realtime/centrifugo');

// node-pg parses SQL DATE columns into JS Date objects — String(dateObject)
// calls toString() ("Thu Jul 09 2026 00:00:00 GMT+0000..."), not
// toISOString(), so a plain String(x).slice(0,10) silently produces "Thu
// Jul 09" instead of "2026-07-09". Use this wherever a date column arrives
// via SELECT * (so it can't be cast to text in the query itself).
function toISODate(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function gAudit(actor_id, action, target_type, target_id, payload, ip) {
  query(
    `INSERT INTO guardian_audit_log
       (actor_type, actor_id, action, target_type, target_id, payload, ip_address)
     VALUES ('admin',$1,$2,$3,$4,$5,$6)`,
    [actor_id || null, action, target_type || null, target_id || null,
      payload ? JSON.stringify(payload) : null, ip || null]
  ).catch((err) => logger.error(`gAudit error: ${err.message}`));
}

const truckSchema = Joi.object({
  vehicle_id: Joi.string().uuid().allow('', null).optional(),
  registration: Joi.string().max(50).allow('', null),
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

  const cfoUserIds = new Set(cfos.map((c) => c.cfo_user_id));
  if (cfoUserIds.size !== cfos.length) {
    return { error: 'duplicate_cfo_user_id' };
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
           (convoy_id, vehicle_id, registration, driver_name, driver_phone, driver_license_no, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, position`,
        [convoy.id, truck.vehicle_id || null, truck.registration || null, truck.driver_name,
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

    publish(`org#${req.user.org_id}`, { type: 'convoy.update', convoyId: convoy.id, status: 'planned' });

    res.status(201).json({ data: convoy });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message?.includes('convoy_truck_limit_exceeded')) {
      return res.status(422).json({ error: 'convoy_truck_limit_exceeded' });
    }
    if (err.message?.includes('cfo_truck_limit_exceeded')) {
      return res.status(422).json({ error: 'cfo_truck_limit_exceeded' });
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
    registration: Joi.string().max(50).allow('', null),
    driver_name: Joi.string().min(1).max(100).required(),
    driver_phone: Joi.string().max(30).allow('', null),
    driver_license_no: Joi.string().max(50).allow('', null),
    position: Joi.number().integer().min(1).max(6).required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  if (!value.vehicle_id && !value.registration) {
    return res.status(400).json({ error: 'registration is required when no fleet vehicle is linked' });
  }

  const convoy = await query(
    'SELECT id, status FROM convoys WHERE id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  // Matches addCfo's policy: roster/truck changes are allowed on planned AND active
  // convoys (an admin correcting a staffing mistake mid-convoy is a normal operation),
  // just not once a convoy is completing/completed/aborted/cancelled.
  if (!['planned', 'active'].includes(convoy.rows[0].status))
    return res.status(422).json({ error: 'convoy_not_in_planned_status' });

  try {
    const result = await query(
      `INSERT INTO convoy_trucks
         (convoy_id, vehicle_id, registration, driver_name, driver_phone, driver_license_no, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [req.params.id, value.vehicle_id || null, value.registration || null, value.driver_name,
        value.driver_phone || null, value.driver_license_no || null, value.position]
    );
    const newTruck = result.rows[0];

    // createConvoyCfo enforces full CFO coverage of every truck at creation time
    // (validateCoverage), but a truck added later here had no equivalent — it sat
    // with zero convoy_cfo_truck_assignments rows, invisible in the Guardian app
    // and permanently unphotographable, which also kept required_photo_count
    // for the day out of reach forever. Auto-assign the sole CFO officer (capped
    // at 2 trucks each, mirroring the original coverage schema) so a newly added
    // truck is immediately usable; convoys with multiple CFOs still need a
    // manual pick since it's ambiguous which officer should take it.
    const cfoRows = await query(
      `SELECT cc.cfo_user_id,
              (SELECT COUNT(*)::int FROM convoy_cfo_truck_assignments ccta
               WHERE ccta.cfo_user_id = cc.cfo_user_id AND ccta.convoy_id = cc.convoy_id) AS truck_count
       FROM convoy_cfos cc WHERE cc.convoy_id = $1`,
      [req.params.id]
    );
    if (cfoRows.rows.length === 1 && cfoRows.rows[0].truck_count < 2) {
      await query(
        `INSERT INTO convoy_cfo_truck_assignments (convoy_id, cfo_user_id, convoy_truck_id) VALUES ($1,$2,$3)`,
        [req.params.id, cfoRows.rows[0].cfo_user_id, newTruck.id]
      ).catch((e) => logger.warn(`auto-assign new truck to CFO failed: ${e.message}`));
    }

    gAudit(req.user.id, 'convoy_truck_added', 'convoy_truck', newTruck.id, { convoy_id: req.params.id }, req.ip);
    res.status(201).json({ data: newTruck });
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
  // Matches addCfo's policy: roster/truck changes are allowed on planned AND active
  // convoys (an admin correcting a staffing mistake mid-convoy is a normal operation),
  // just not once a convoy is completing/completed/aborted/cancelled.
  if (!['planned', 'active'].includes(convoy.rows[0].status))
    return res.status(422).json({ error: 'convoy_not_in_planned_status' });

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
  if (!['planned', 'active'].includes(convoy.rows[0].status))
    return res.status(422).json({ error: 'convoy_not_in_planned_status' });

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

    // Auto-link: if no device was supplied, find a guardian device whose assignment_id
    // matches this CFO user and wire it up automatically
    if (!value.guardian_device_id) {
      query(
        `UPDATE convoy_cfos
         SET guardian_device_id = (
           SELECT id FROM guardian_devices
           WHERE assignment_id = $2
             AND deleted_at IS NULL
             AND status NOT IN ('revoked','suspended')
           ORDER BY last_seen DESC NULLS LAST
           LIMIT 1
         )
         WHERE id = $1 AND guardian_device_id IS NULL`,
        [result.rows[0].id, value.cfo_user_id]
      ).catch((e) => console.warn(`[convoy_cfos] auto-link on addCfo: ${e.message}`));
    }

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
  // Matches addCfo's policy: roster/truck changes are allowed on planned AND active
  // convoys (an admin correcting a staffing mistake mid-convoy is a normal operation),
  // just not once a convoy is completing/completed/aborted/cancelled.
  if (!['planned', 'active'].includes(convoy.rows[0].status))
    return res.status(422).json({ error: 'convoy_not_in_planned_status' });

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
  // Matches addCfo's policy: roster/truck changes are allowed on planned AND active
  // convoys (an admin correcting a staffing mistake mid-convoy is a normal operation),
  // just not once a convoy is completing/completed/aborted/cancelled.
  if (!['planned', 'active'].includes(convoy.rows[0].status))
    return res.status(422).json({ error: 'convoy_not_in_planned_status' });

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
  // Matches addCfo's policy: roster/truck changes are allowed on planned AND active
  // convoys (an admin correcting a staffing mistake mid-convoy is a normal operation),
  // just not once a convoy is completing/completed/aborted/cancelled.
  if (!['planned', 'active'].includes(convoy.rows[0].status))
    return res.status(422).json({ error: 'convoy_not_in_planned_status' });

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

// E5 — list daily reports for a convoy with per-truck photo breakdown
const getConvoyReports = asyncHandler(async (req, res) => {
  const convoyRes = await query(
    `SELECT c.*, c.archive_pdf_url FROM convoys c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!convoyRes.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const convoy = convoyRes.rows[0];
  const sealCount = convoy.seal_count_per_truck ?? 3;

  const [trucksRes, cfosRes, reportsRes] = await Promise.all([
    query('SELECT * FROM convoy_trucks WHERE convoy_id = $1 ORDER BY position', [req.params.id]),
    query(
      `SELECT cc.id AS convoy_cfo_id, cc.cfo_user_id, cc.guardian_device_id,
              u.name AS cfo_name, u.email AS cfo_email
       FROM convoy_cfos cc JOIN users u ON u.id = cc.cfo_user_id WHERE cc.convoy_id = $1`,
      [req.params.id]
    ),
    query(
      `SELECT * FROM convoy_daily_reports WHERE convoy_id = $1 ORDER BY report_date DESC`,
      [req.params.id]
    ),
  ]);

  const trucks = trucksRes.rows;
  const reportDates = reportsRes.rows.map(r => toISODate(r.report_date));
  let allPhotos = [];
  if (reportDates.length > 0) {
    const photosRes = await query(
      `SELECT convoy_truck_id, session, photo_type, seal_position,
              uploaded_at, location_mismatch, report_date
       FROM convoy_truck_photos WHERE convoy_id = $1 AND report_date = ANY($2::date[])`,
      [req.params.id, reportDates]
    );
    allPhotos = photosRes.rows;
  }

  const buildSession = (photos, session) => ({
    front: photos.some(p => p.session === session && p.photo_type === 'front'),
    rear: photos.some(p => p.session === session && p.photo_type === 'rear'),
    seals: Array.from({ length: sealCount }, (_, i) =>
      photos.some(p => p.session === session && p.photo_type === 'seal' && String(p.seal_position) === String(i + 1))
    ),
  });

  const dailyReports = reportsRes.rows.map(report => {
    const dateStr = toISODate(report.report_date);
    const dayPhotos = allPhotos.filter(p => toISODate(p.report_date) === dateStr);
    return {
      ...report,
      location_mismatch_count: dayPhotos.filter(p => p.location_mismatch).length,
      trucks: trucks.map(truck => {
        const tp = dayPhotos.filter(p => p.convoy_truck_id === truck.id);
        return {
          convoy_truck_id: truck.id,
          position: truck.position,
          driver_name: truck.driver_name,
          vehicle_id: truck.vehicle_id,
          sod: buildSession(tp, 'sod'),
          eod: buildSession(tp, 'eod'),
          total_photos: tp.length,
          required_photos: (2 + sealCount) * 2,
        };
      }),
    };
  });

  res.json({ data: { convoy, trucks, cfos: cfosRes.rows, daily_reports: dailyReports } });
});

// E5 — trigger PDF re-generation for a specific date
const regenerateReport = asyncHandler(async (req, res) => {
  const convoy = await query('SELECT id FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

  let report = await query(
    'SELECT id FROM convoy_daily_reports WHERE convoy_id = $1 AND report_date = $2',
    [req.params.id, date]
  );

  if (!report.rows.length) {
    // No row yet — check if real photo data exists for this date in
    // convoy_truck_photos (the table the live CFO app actually writes to;
    // photo_uploads is a legacy/unused table from an earlier upload path).
    const photoCount = await query(
      `SELECT COUNT(*)::int AS n FROM convoy_truck_photos WHERE convoy_id = $1 AND report_date = $2`,
      [req.params.id, date]
    );
    if (!photoCount.rows[0].n) return res.status(404).json({ error: 'No report data for this date' });
  }

  // Recompute required/received via the shared, slot-capped counter (not a
  // raw COUNT(*)) so a stale or first-time row can't bake a >100%
  // completeness figure into the regenerated PDF — seal_position is a
  // free-text RFID code, so a truck can otherwise accumulate more distinct
  // values than seal_count_per_truck allows.
  const { recountPhotos } = require('../workers/convoyReportWorker');
  await recountPhotos(req.params.id, date);

  // Reset to partial (clearing any stale PDF) so the worker regenerates it —
  // handleGenerateReport skips rows already marked 'generated'.
  report = await query(
    `UPDATE convoy_daily_reports SET status = 'partial', pdf_url = NULL, generation_error = NULL, updated_at = NOW()
     WHERE convoy_id = $1 AND report_date = $2
     RETURNING id`,
    [req.params.id, date]
  );
  if (!report.rows.length) return res.status(404).json({ error: 'No report data for this date' });

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

// B2b — link a guardian device to an existing CFO slot (works on any convoy status)
const linkDevice = asyncHandler(async (req, res) => {
  if (!await isCfoModuleEnabled()) return res.status(403).json({ error: 'cfo_module_disabled' });

  const { device_id } = req.body;
  if (!device_id || typeof device_id !== 'string') {
    return res.status(400).json({ error: 'device_id is required' });
  }

  const cfoEntry = await query(
    `SELECT cc.id FROM convoy_cfos cc
     JOIN convoys c ON c.id = cc.convoy_id
     WHERE cc.id = $1 AND cc.convoy_id = $2 AND c.deleted_at IS NULL`,
    [req.params.cfoId, req.params.id]
  );
  if (!cfoEntry.rows.length) return res.status(404).json({ error: 'CFO slot not found in convoy' });

  const device = await query(
    `SELECT id FROM guardian_devices WHERE id = $1 AND deleted_at IS NULL`,
    [device_id]
  );
  if (!device.rows.length) return res.status(404).json({ error: 'Guardian device not found' });

  const result = await query(
    `UPDATE convoy_cfos SET guardian_device_id = $1 WHERE id = $2 RETURNING *`,
    [device_id, req.params.cfoId]
  );

  gAudit(req.user.id, 'convoy_cfo_device_linked', 'convoy_cfo', req.params.cfoId,
    { convoy_id: req.params.id, device_id }, req.ip);
  res.json({ data: result.rows[0] });
});

// E5 — stream the generated PDF (R2 redirect or local fallback)
const downloadReport = asyncHandler(async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const convoy = await query('SELECT id FROM convoys WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!convoy.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const r = await query(
    `SELECT pdf_url, status, pdf_data FROM convoy_daily_reports WHERE convoy_id = $1 AND report_date = $2`,
    [req.params.id, date]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Report not found' });
  if (r.rows[0].status !== 'generated') return res.status(422).json({ error: `Report status: ${r.rows[0].status}` });
  const r2PublicUrl = process.env.R2_PUBLIC_URL;
  const pdfUrl = r.rows[0].pdf_url && r2PublicUrl
    ? r.rows[0].pdf_url.replace(/^https?:\/\/pub-[a-f0-9]+\.r2\.dev\//, `${r2PublicUrl}/`)
    : r.rows[0].pdf_url;
  if (pdfUrl?.startsWith('http')) return res.redirect(pdfUrl);
  const filePath = path.resolve(__dirname, '../../data/reports', req.params.id, `${date}.pdf`);
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="convoy-report-${date}.pdf"`);
    return fs.createReadStream(filePath).pipe(res);
  }
  // Last resort: the in-DB copy survives even when R2 is unconfigured and the
  // local-disk fallback was wiped by a redeploy (Railway's filesystem is
  // ephemeral, but the database is not).
  if (r.rows[0].pdf_data) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="convoy-report-${date}.pdf"`);
    return res.send(r.rows[0].pdf_data);
  }
  return res.status(404).json({ error: 'PDF not on server — please regenerate' });
});

// E5 — org-wide overview of all convoy report statuses
const getConvoyReportsOverview = asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const convoysRes = await query(
    `SELECT c.id, c.name, c.status, c.timezone, c.start_date, c.end_date,
            c.seal_count_per_truck, c.archive_pdf_url,
            (SELECT COUNT(*) FROM convoy_trucks ct WHERE ct.convoy_id = c.id)::int AS truck_count,
            (SELECT COUNT(*) FROM convoy_cfos cc WHERE cc.convoy_id = c.id)::int AS cfo_count
     FROM convoys c
     WHERE c.org_id = $1 AND c.deleted_at IS NULL
       AND c.status IN ('planned','active','completing','completed')
     ORDER BY (c.status = 'active') DESC, c.start_date DESC LIMIT 200`,
    [orgId]
  );
  if (!convoysRes.rows.length) return res.json({ data: [] });

  const convoyIds = convoysRes.rows.map(c => c.id);
  const [latestReports, mismatchCounts, cfoAppReports] = await Promise.all([
    query(
      // A stray convoy_daily_reports row from before the convoy's own
      // start_date (bad test data, a client clock issue, a manual regenerate
      // with the wrong date) used to win "latest" purely by being the
      // newest by date, showing a blank/nonsensical report for a day the
      // convoy didn't exist yet. Only excluding the lower bound — end_date
      // is a plan, not a hard stop; an active convoy legitimately keeps
      // getting real uploads past its original planned end date.
      // report_date::text — node-pg parses SQL DATE columns into JS Date
      // objects, and String(dateObject) calls toString() ("Thu Jul 09 2026
      // 00:00:00 GMT+0000..."), not toISOString(). Slicing that gives "Thu
      // Jul 09" instead of "2026-07-09", which the frontend then mis-parses
      // in the browser's local timezone, shifting the date by a day. Casting
      // to text in SQL sidesteps the whole Date-object ambiguity.
      `SELECT DISTINCT ON (cdr.convoy_id) cdr.convoy_id, cdr.report_date::text AS report_date, cdr.status,
              cdr.required_photo_count, cdr.received_photo_count, cdr.pdf_url,
              cdr.generated_at, cdr.generation_error
       FROM convoy_daily_reports cdr
       JOIN convoys c ON c.id = cdr.convoy_id
       WHERE cdr.convoy_id = ANY($1)
         AND (c.start_date IS NULL OR cdr.report_date >= c.start_date)
       ORDER BY cdr.convoy_id, cdr.report_date DESC`,
      [convoyIds]
    ),
    query(
      `SELECT convoy_id, report_date::text AS report_date, COUNT(*)::int AS mismatch_count
       FROM convoy_truck_photos WHERE convoy_id = ANY($1) AND location_mismatch = true
       GROUP BY convoy_id, report_date`,
      [convoyIds]
    ),
    // Guardian Convoy app reports (newer system using convoy_reports + photo_uploads)
    query(
      `SELECT DISTINCT ON (cr.convoy_id)
              cr.convoy_id, cr.date::text AS report_date, cr.status,
              (SELECT COUNT(*)::int FROM photo_uploads pu
               WHERE pu.convoy_id = cr.convoy_id AND pu.timestamp::date = cr.date) AS received_photo_count,
              (SELECT COUNT(ct.id) FROM convoy_trucks ct WHERE ct.convoy_id::text = cr.convoy_id)::int
                * (2 + COALESCE(c2.seal_count_per_truck, 0)) * 2 AS required_photo_count
       FROM convoy_reports cr
       LEFT JOIN convoys c2 ON c2.id::text = cr.convoy_id
       WHERE cr.convoy_id = ANY($1::text[])
         AND (c2.start_date IS NULL OR cr.date >= c2.start_date)
       ORDER BY cr.convoy_id, cr.date DESC`,
      [convoyIds]
    ),
  ]);

  const reportMap = new Map(latestReports.rows.map(r => [String(r.convoy_id), r]));
  const cfoReportMap = new Map(cfoAppReports.rows.map(r => [String(r.convoy_id), r]));
  const mismatchMap = new Map(
    mismatchCounts.rows.map(m => [`${m.convoy_id}:${m.report_date}`, m.mismatch_count])
  );

  const data = convoysRes.rows.map(c => {
    const report = reportMap.get(String(c.id)) ?? null;
    const cfoReport = cfoReportMap.get(String(c.id)) ?? null;
    const effective = report ?? cfoReport;
    const rDate = effective ? String(effective.report_date).slice(0, 10) : null;
    return {
      ...c,
      latest_report: effective ? {
        report_date: rDate,
        status: effective.status,
        required_photo_count: effective.required_photo_count,
        received_photo_count: effective.received_photo_count,
        pdf_url: report?.pdf_url ?? null,
        generated_at: report?.generated_at ?? null,
        generation_error: report?.generation_error ?? null,
        location_mismatch_count: rDate ? (mismatchMap.get(`${c.id}:${rDate}`) ?? 0) : 0,
      } : null,
    };
  });
  res.json({ data });
});

// ─── E6: Per-date Report Detail ──────────────────────────────────────────────

async function getConvoyReportDetail(req, res, next) {
  try {
    const { id, date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const { query } = require('../config/database');

    const convoyRes = await query(
      `SELECT id, name, status, start_date, end_date, timezone, seal_count_per_truck
       FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!convoyRes.rows.length) return res.status(404).json({ error: 'Convoy not found' });

    const [trucksRes, photosRes, sealsRes, waypointsRes, reportRes] = await Promise.all([
      query(
        `SELECT ct.id, COALESCE(ct.registration, v.registration) AS plate_number, v.make, v.model, ct.position,
                u.name AS cfo_name, u.id AS cfo_user_id
         FROM convoy_trucks ct
         LEFT JOIN vehicles v ON v.id = ct.vehicle_id
         LEFT JOIN convoy_cfo_truck_assignments ccta
               ON ccta.convoy_truck_id = ct.id AND ccta.convoy_id = $1
         LEFT JOIN users u ON u.id = ccta.cfo_user_id
         WHERE ct.convoy_id = $1
         ORDER BY ct.position`,
        [id]
      ),
      query(
        `SELECT id, convoy_truck_id, session, photo_type, seal_position,
                photo_url, taken_at, lat, lng, location_mismatch, notes
         FROM convoy_truck_photos
         WHERE convoy_id = $1 AND report_date = $2
         ORDER BY convoy_truck_id, session, photo_type`,
        [id, date]
      ),
      query(
        `SELECT id, convoy_truck_id, seal_position, rfid_code, session,
                status, photo_url, notes, scanned_at
         FROM convoy_seals
         WHERE convoy_id = $1 AND report_date = $2
         ORDER BY convoy_truck_id, seal_position`,
        [id, date]
      ),
      query(
        `SELECT lat, lng, speed_kmh, heading, recorded_at
         FROM convoy_waypoints
         WHERE convoy_id = $1 AND recorded_at::date = $2::date
         ORDER BY recorded_at
         LIMIT 500`,
        [id, date]
      ),
      query(
        `SELECT status, received_photo_count, required_photo_count,
                generated_at, pdf_url, generation_error
         FROM convoy_daily_reports
         WHERE convoy_id = $1 AND report_date = $2`,
        [id, date]
      ),
    ]);

    // CFO-app tables use FORCE RLS — run separately so any failure degrades
    // gracefully to empty arrays rather than 500ing the whole endpoint
    const { withOrg } = require('../utils/orgScopedDb');
    const orgId = req.user?.org_id;
    let cfoUploadsRows = [], cfoReportRows = [];
    if (orgId) {
      try {
        [cfoUploadsRows, cfoReportRows] = await withOrg(orgId, async (client) => {
          const [u, r] = await Promise.all([
            client.query(
              `SELECT pu.id, pu.photo_type, pu.r2_url AS photo_url,
                      pu.phase AS session, pu.plate_number, pu.lat, pu.lng,
                      pu.timestamp AS taken_at, u.name AS cfo_name
               FROM photo_uploads pu
               LEFT JOIN users u ON u.id::text = pu.cfo_id
               WHERE pu.convoy_id = $1::text AND pu.timestamp::date = $2::date
               ORDER BY pu.timestamp`,
              [id, date]
            ),
            client.query(
              `SELECT cr.status, cr.sod_submitted_at, cr.eod_submitted_at, cr.handover_form_url,
                      u.name AS cfo_name
               FROM convoy_reports cr
               LEFT JOIN users u ON u.id::text = cr.cfo_id
               WHERE cr.convoy_id = $1::text AND cr.date = $2::date`,
              [id, date]
            ),
          ]);
          return [u.rows, r.rows];
        });
      } catch (cfoErr) {
        logger.error(`getConvoyReportDetail: CFO-app queries failed (non-fatal): ${cfoErr.message}`);
      }
    }
    const cfoUploadsRes = { rows: cfoUploadsRows };
    const cfoReportRes = { rows: cfoReportRows };

    const r2PublicUrl = process.env.R2_PUBLIC_URL;
    const normalizePhotoUrl = (url) => {
      if (!url || !r2PublicUrl) return url;
      return url.replace(/^https?:\/\/pub-[a-f0-9]+\.r2\.dev\//, `${r2PublicUrl}/`);
    };

    const photosByTruck = {};
    for (const p of photosRes.rows) {
      p.photo_url = normalizePhotoUrl(p.photo_url);
      (photosByTruck[p.convoy_truck_id] = photosByTruck[p.convoy_truck_id] || []).push(p);
    }
    const sealsByTruck = {};
    for (const s of sealsRes.rows) {
      s.photo_url = normalizePhotoUrl(s.photo_url);
      (sealsByTruck[s.convoy_truck_id] = sealsByTruck[s.convoy_truck_id] || []).push(s);
    }

    // Synthesize daily_report from CFO app data when no PDF report exists yet
    let dailyReport = reportRes.rows[0] || null;
    if (dailyReport) dailyReport.pdf_url = normalizePhotoUrl(dailyReport.pdf_url);
    if (!dailyReport && cfoReportRes.rows.length) {
      const cr = cfoReportRes.rows[0];
      const sealCount = convoyRes.rows[0].seal_count_per_truck ?? 0;
      dailyReport = {
        status: cr.status,
        received_photo_count: cfoUploadsRes.rows.length,
        required_photo_count: trucksRes.rows.length * (2 + sealCount) * 2,
        generated_at: null,
        pdf_url: null,
        generation_error: null,
      };
    }

    res.json({
      data: {
        convoy: convoyRes.rows[0],
        report_date: date,
        daily_report: dailyReport,
        trucks: trucksRes.rows.map(t => ({
          ...t,
          photos: photosByTruck[t.id] || [],
          seals: sealsByTruck[t.id] || [],
        })),
        waypoints: waypointsRes.rows,
        cfo_uploads: cfoUploadsRes.rows.map(u => ({ ...u, photo_url: normalizePhotoUrl(u.photo_url) })),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createConvoyCfo,
  addTruck,
  removeTruck,
  addCfo,
  removeCfo,
  assignTruckToCfo,
  removeAssignment,
  getConvoyReports,
  getConvoyReportDetail,
  regenerateReport,
  downloadReport,
  linkDevice,
  getConvoyReportsOverview,
};
