/**
 * S2-F6: Shift & Roster Management
 * RULE D: POST /shifts requires X-Idempotency-Key
 */
const router = require('express').Router();
const Joi = require('joi');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { auditLog } = require('../middleware/audit');

router.use(authenticate, attachOrgDb);

const shiftSchema = Joi.object({
  driver_id: Joi.string().uuid(),
  vehicle_id: Joi.string().uuid(),
  convoy_id: Joi.string().uuid(),
  role: Joi.string().valid('driver', 'co_driver', 'loader', 'escort', 'supervisor').default('driver'),
  start_time: Joi.string().isoDate().required(),
  end_time: Joi.string().isoDate().required(),
  notes: Joi.string().max(2000),
});

// GET /shifts — list shifts
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit) || 100);
  const from = req.query.from;
  const to = req.query.to;
  const driverId = req.query.driver_id;

  const filters = [];
  const params = [];
  if (from) { params.push(from); filters.push(`s.start_time >= $${params.length}`); }
  if (to) { params.push(to); filters.push(`s.end_time <= $${params.length}`); }
  if (driverId) { params.push(driverId); filters.push(`s.driver_id = $${params.length}`); }
  params.push(limit);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await req.db(
    `SELECT s.*, u.name AS driver_name, v.registration_number AS vehicle_reg
       FROM shifts s
       LEFT JOIN users u ON u.id = s.driver_id
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
      ${where}
      ORDER BY s.start_time DESC
      LIMIT $${params.length}`,
    params,
  );
  res.json({ data: result.rows });
}));

// GET /shifts/on-duty — drivers currently on shift
router.get('/on-duty', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT s.*, u.name AS driver_name, u.phone AS driver_phone, v.registration_number AS vehicle_reg
       FROM shifts s
       LEFT JOIN users u ON u.id = s.driver_id
       LEFT JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.status = 'active'
         OR (s.status = 'scheduled' AND s.start_time <= NOW() AND s.end_time >= NOW())
      ORDER BY s.start_time ASC`,
  );
  res.json({ data: result.rows });
}));

// GET /shifts/coverage — per-day coverage summary for next 7 days
router.get('/coverage', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT
       DATE_TRUNC('day', s.start_time) AS day,
       COUNT(DISTINCT s.driver_id) AS drivers_scheduled,
       COUNT(*) AS shifts_count
     FROM shifts s
     WHERE s.start_time BETWEEN NOW() AND NOW() + INTERVAL '7 days'
       AND s.status NOT IN ('cancelled')
     GROUP BY day
     ORDER BY day ASC`,
  );
  res.json({ data: result.rows });
}));

// POST /shifts
router.post('/', auditLog('shifts'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey) return res.status(400).json({ error: 'X-Idempotency-Key header required' });

  const { error, value } = shiftSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  if (new Date(value.end_time) <= new Date(value.start_time)) {
    return res.status(400).json({ error: 'end_time must be after start_time' });
  }

  const result = await req.db(
    `INSERT INTO shifts (org_id, driver_id, vehicle_id, convoy_id, role, start_time, end_time, notes, created_by)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [value.driver_id || null, value.vehicle_id || null, value.convoy_id || null,
     value.role, value.start_time, value.end_time, value.notes || null, req.user.id],
  );
  req.auditAction = 'CREATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.status(201).json({ data: result.rows[0] });
}));

// PUT /shifts/:id
router.put('/:id', auditLog('shifts'), asyncHandler(async (req, res) => {
  const { error, value } = shiftSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `UPDATE shifts
        SET driver_id  = COALESCE($1, driver_id),
            vehicle_id = COALESCE($2, vehicle_id),
            convoy_id  = COALESCE($3, convoy_id),
            role       = COALESCE($4, role),
            start_time = COALESCE($5, start_time),
            end_time   = COALESCE($6, end_time),
            notes      = COALESCE($7, notes),
            updated_at = NOW()
      WHERE id = $8 AND status = 'scheduled'
      RETURNING *`,
    [value.driver_id || null, value.vehicle_id || null, value.convoy_id || null,
     value.role, value.start_time, value.end_time, value.notes || null, req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Shift not found or not schedulable' });
  req.auditAction = 'UPDATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.json({ data: result.rows[0] });
}));

// DELETE /shifts/:id — cancel
router.delete('/:id', auditLog('shifts'), asyncHandler(async (req, res) => {
  const result = await req.db(
    `UPDATE shifts SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND status IN ('scheduled') RETURNING id`,
    [req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Shift not found or cannot cancel' });
  req.auditAction = 'DELETE';
  req.auditRecordId = result.rows[0].id;
  res.json({ ok: true });
}));

// POST /shifts/:id/handover
const handoverSchema = Joi.object({
  to_shift_id: Joi.string().uuid().required(),
  odometer_km: Joi.number().positive(),
  fuel_level_pct: Joi.number().integer().min(0).max(100),
  condition_notes: Joi.string().max(2000),
  seal_intact: Joi.boolean(),
  voice_note_id: Joi.string().uuid(),
});

router.post('/:id/handover', auditLog('shift_handovers'), asyncHandler(async (req, res) => {
  const { error, value } = handoverSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `INSERT INTO shift_handovers
       (org_id, from_shift_id, to_shift_id, odometer_km, fuel_level_pct,
        condition_notes, seal_intact, voice_note_id)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [req.params.id, value.to_shift_id, value.odometer_km || null,
     value.fuel_level_pct ?? null, value.condition_notes || null,
     value.seal_intact ?? null, value.voice_note_id || null],
  );

  // Mark from_shift as completed
  await req.db(
    `UPDATE shifts SET status = 'completed', actual_end = NOW(), updated_at = NOW() WHERE id = $1`,
    [req.params.id],
  );
  // Mark to_shift as active
  await req.db(
    `UPDATE shifts SET status = 'active', actual_start = NOW(), updated_at = NOW() WHERE id = $1`,
    [value.to_shift_id],
  );

  req.auditAction = 'CREATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.status(201).json({ data: result.rows[0] });
}));

// GET /shifts/:id/handover
router.get('/:id/handover', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT h.*,
            uf.name AS from_driver_name,
            ut.name AS to_driver_name
       FROM shift_handovers h
       JOIN shifts sf ON sf.id = h.from_shift_id
       JOIN shifts st ON st.id = h.to_shift_id
       LEFT JOIN users uf ON uf.id = sf.driver_id
       LEFT JOIN users ut ON ut.id = st.driver_id
      WHERE h.from_shift_id = $1 OR h.to_shift_id = $1
      ORDER BY h.created_at DESC
      LIMIT 1`,
    [req.params.id],
  );
  res.json({ data: result.rows[0] ?? null });
}));

// PATCH /shifts/handovers/:handoverId/ack
router.patch('/handovers/:handoverId/ack', auditLog('shift_handovers'), asyncHandler(async (req, res) => {
  const result = await req.db(
    `UPDATE shift_handovers
        SET ack_at = NOW(), ack_by = $1, updated_at = NOW()
      WHERE id = $2 AND ack_at IS NULL
      RETURNING *`,
    [req.user.id, req.params.handoverId],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Handover not found or already acknowledged' });
  req.auditAction = 'UPDATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.json({ data: result.rows[0] });
}));

module.exports = router;
