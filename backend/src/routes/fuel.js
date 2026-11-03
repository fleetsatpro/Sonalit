/**
 * S2-F2: Fuel Management + Anomaly Detection
 *
 * Webhook endpoint (POST /fuel/webhook/fuel-card):
 *   - No JWT / CSRF (RULE D)
 *   - Verified by HMAC-SHA256 of raw body using FUEL_CARD_WEBHOOK_SECRET
 *   - Must be mounted BEFORE csrf middleware in app.js
 *
 * All other endpoints: authenticated + org-scoped via req.db
 */
const router = require('express').Router();
const crypto = require('crypto');
const Joi = require('joi');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { withOrg } = require('../utils/orgScopedDb');
const { detectAnomalies } = require('../utils/fuelAnomalyDetector');
const { asyncHandler } = require('../middleware/error');
const { auditLog } = require('../middleware/audit');

// ─── Webhook (no auth, HMAC-verified) ────────────────────────────────────────

router.post('/webhook/fuel-card', auditLog('fuel_entries'), asyncHandler(async (req, res) => {
  const secret = process.env.FUEL_CARD_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook not configured' });

  const sig = req.headers['x-fuel-hmac'] || req.headers['x-hub-signature-256'] || '';
  const rawBody = req.rawBody;
  if (!rawBody) return res.status(400).json({ error: 'Raw body unavailable' });

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let valid = false;
  try {
    valid = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (_) {}
  if (!valid) return res.status(401).json({ error: 'Invalid webhook signature' });

  const payload = req.body;
  const orgId = payload.org_id;
  if (!orgId) return res.status(400).json({ error: 'org_id required in payload' });

  await withOrg(orgId, async (db) => {
    const entry = {
      org_id: orgId,
      vehicle_id: payload.vehicle_id || null,
      driver_id: payload.driver_id || null,
      convoy_id: payload.convoy_id || null,
      source: 'fuel_card_webhook',
      litres: payload.litres,
      cost_per_litre: payload.cost_per_litre || null,
      total_cost: payload.total_cost || null,
      currency: payload.currency || 'KES',
      odometer_km: payload.odometer_km || null,
      station_name: payload.station_name || null,
      station_lat: payload.station_lat || null,
      station_lng: payload.station_lng || null,
      fuel_card_ref: payload.fuel_card_ref || null,
      idempotency_key: payload.idempotency_key || payload.transaction_id || null,
    };

    const result = await db.query(
      `INSERT INTO fuel_entries
         (org_id, vehicle_id, driver_id, convoy_id, source, litres, cost_per_litre, total_cost,
          currency, odometer_km, station_name, station_lat, station_lng, fuel_card_ref, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [entry.org_id, entry.vehicle_id, entry.driver_id, entry.convoy_id, entry.source,
       entry.litres, entry.cost_per_litre, entry.total_cost, entry.currency, entry.odometer_km,
       entry.station_name, entry.station_lat, entry.station_lng, entry.fuel_card_ref, entry.idempotency_key],
    );

    if (result.rows.length) {
      const row = result.rows[0];
      req.auditAction = 'CREATE';
      req.auditRecordId = row.id;
      req.auditAfter = row;
      const anomalies = await detectAnomalies(orgId, { ...entry, id: row.id });
      for (const a of anomalies) {
        await db.query(
          `INSERT INTO fuel_anomalies (org_id, fuel_entry_id, vehicle_id, anomaly_type, severity, description)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [a.org_id, a.fuel_entry_id, a.vehicle_id, a.anomaly_type, a.severity, a.description],
        );
      }
    }
  });

  res.json({ ok: true });
}));

// ─── Authenticated routes ─────────────────────────────────────────────────────
router.use(authenticate, attachOrgDb);

const fuelEntrySchema = Joi.object({
  vehicle_id: Joi.string().uuid(),
  driver_id: Joi.string().uuid(),
  convoy_id: Joi.string().uuid(),
  litres: Joi.number().positive().required(),
  cost_per_litre: Joi.number().positive(),
  total_cost: Joi.number().positive(),
  currency: Joi.string().length(3).default('KES'),
  odometer_km: Joi.number().positive(),
  station_name: Joi.string().max(200),
  station_lat: Joi.number().min(-90).max(90),
  station_lng: Joi.number().min(-180).max(180),
  fuel_card_ref: Joi.string().max(100),
  notes: Joi.string().max(1000),
});

// GET /fuel — list fuel entries
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const offset = parseInt(req.query.offset) || 0;
  const vehicleId = req.query.vehicle_id;
  const convoyId = req.query.convoy_id;

  const filters = ['f.deleted_at IS NULL'];
  const params = [];

  if (vehicleId) { params.push(vehicleId); filters.push(`f.vehicle_id = $${params.length}`); }
  if (convoyId) { params.push(convoyId); filters.push(`f.convoy_id = $${params.length}`); }

  params.push(limit, offset);
  const result = await req.db(
    `SELECT f.*,
            v.registration AS vehicle_reg,
            u.name AS driver_name
       FROM fuel_entries f
       LEFT JOIN vehicles v ON v.id = f.vehicle_id
       LEFT JOIN users u ON u.id = f.driver_id
      WHERE ${filters.join(' AND ')}
      ORDER BY f.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ data: result.rows });
}));

// POST /fuel — create fuel entry
router.post('/', auditLog('fuel_entries'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey) return res.status(400).json({ error: 'X-Idempotency-Key header required' });

  const { error, value } = fuelEntrySchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `INSERT INTO fuel_entries
       (org_id, vehicle_id, driver_id, convoy_id, source, litres, cost_per_litre, total_cost,
        currency, odometer_km, station_name, station_lat, station_lng, fuel_card_ref, notes, idempotency_key)
     VALUES ((current_setting('app.current_org_id',true))::uuid,$1,$2,$3,'manual',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [value.vehicle_id || null, value.driver_id || null, value.convoy_id || null,
     value.litres, value.cost_per_litre || null, value.total_cost || null, value.currency,
     value.odometer_km || null, value.station_name || null, value.station_lat || null,
     value.station_lng || null, value.fuel_card_ref || null, value.notes || null, idempotencyKey],
  );

  const row = result.rows[0];
  req.auditAction = 'CREATE';
  req.auditRecordId = row.id;
  req.auditAfter = row;
  const orgId = req.user.org_id;
  const anomalies = await detectAnomalies(orgId, { ...value, id: row.id, org_id: orgId });
  for (const a of anomalies) {
    await req.db(
      `INSERT INTO fuel_anomalies (org_id, fuel_entry_id, vehicle_id, anomaly_type, severity, description)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [a.org_id, a.fuel_entry_id, a.vehicle_id, a.anomaly_type, a.severity, a.description],
    );
  }

  res.status(201).json({ data: row, anomalies_detected: anomalies.length });
}));

// PUT /fuel/:id — update fuel entry
router.put('/:id', auditLog('fuel_entries'), asyncHandler(async (req, res) => {
  const { error, value } = fuelEntrySchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `UPDATE fuel_entries
        SET litres = COALESCE($1, litres),
            cost_per_litre = COALESCE($2, cost_per_litre),
            total_cost = COALESCE($3, total_cost),
            odometer_km = COALESCE($4, odometer_km),
            station_name = COALESCE($5, station_name),
            notes = COALESCE($6, notes),
            updated_at = NOW()
      WHERE id = $7 AND deleted_at IS NULL
      RETURNING *`,
    [value.litres, value.cost_per_litre || null, value.total_cost || null,
     value.odometer_km || null, value.station_name || null, value.notes || null, req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Fuel entry not found' });
  req.auditAction = 'UPDATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.json({ data: result.rows[0] });
}));

// DELETE /fuel/:id — soft delete
router.delete('/:id', auditLog('fuel_entries'), asyncHandler(async (req, res) => {
  await req.db(
    `UPDATE fuel_entries SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id],
  );
  req.auditAction = 'DELETE';
  req.auditRecordId = req.params.id;
  res.json({ ok: true });
}));

// GET /fuel/anomalies — list anomalies
router.get('/anomalies', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : null;

  const filters = [];
  const params = [];
  if (resolved !== null) { params.push(resolved); filters.push(`a.resolved = $${params.length}`); }

  params.push(limit);
  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const result = await req.db(
    `SELECT a.*, f.vehicle_id AS entry_vehicle_id, v.registration AS vehicle_reg
       FROM fuel_anomalies a
       LEFT JOIN fuel_entries f ON f.id = a.fuel_entry_id
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
      WHERE TRUE ${where}
      ORDER BY a.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  res.json({ data: result.rows });
}));

// PATCH /fuel/anomalies/:id/resolve
router.patch('/anomalies/:id/resolve', auditLog('fuel_anomalies'), asyncHandler(async (req, res) => {
  const { resolution_note } = req.body;
  const result = await req.db(
    `UPDATE fuel_anomalies
        SET resolved = true, resolved_by = $1, resolved_at = NOW(), resolution_note = $2
      WHERE id = $3
      RETURNING *`,
    [req.user.id, resolution_note || null, req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Anomaly not found' });
  req.auditAction = 'UPDATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.json({ data: result.rows[0] });
}));

// GET /fuel/summary — aggregate stats per vehicle
router.get('/summary', asyncHandler(async (req, res) => {
  const days = Math.min(365, parseInt(req.query.days) || 30);
  const result = await req.db(
    `SELECT v.registration AS registration_number,
            f.vehicle_id,
            COUNT(*) AS fill_count,
            ROUND(SUM(f.litres)::numeric, 2) AS total_litres,
            ROUND(SUM(f.total_cost)::numeric, 2) AS total_cost,
            COUNT(a.id) AS anomaly_count
       FROM fuel_entries f
       LEFT JOIN vehicles v ON v.id = f.vehicle_id
       LEFT JOIN fuel_anomalies a ON a.fuel_entry_id = f.id
      WHERE f.deleted_at IS NULL
        AND f.created_at > NOW() - ($1 || ' days')::interval
      GROUP BY f.vehicle_id, v.registration
      ORDER BY total_litres DESC`,
    [days],
  );
  res.json({ data: result.rows });
}));

// GET /fuel/stations — approved stations
router.get('/stations', asyncHandler(async (req, res) => {
  const result = await req.db(`SELECT * FROM approved_fuel_stations WHERE active = true ORDER BY name`);
  res.json({ data: result.rows });
}));

// POST /fuel/stations
router.post('/stations', auditLog('approved_fuel_stations'), asyncHandler(async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().max(200).required(),
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    radius_km: Joi.number().positive().default(0.5),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `INSERT INTO approved_fuel_stations (org_id, name, lat, lng, radius_km)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1, $2, $3, $4)
     RETURNING *`,
    [value.name, value.lat, value.lng, value.radius_km],
  );
  req.auditAction = 'CREATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.status(201).json({ data: result.rows[0] });
}));

// DELETE /fuel/stations/:id
router.delete('/stations/:id', auditLog('approved_fuel_stations'), asyncHandler(async (req, res) => {
  await req.db(
    `UPDATE approved_fuel_stations SET active = false, updated_at = NOW() WHERE id = $1`,
    [req.params.id],
  );
  req.auditAction = 'DELETE';
  req.auditRecordId = req.params.id;
  res.json({ ok: true });
}));

// GET /fuel/vehicles/:vehicleId — fuel history for one vehicle
router.get('/vehicles/:vehicleId', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const result = await req.db(
    `SELECT f.*, COUNT(a.id) AS anomaly_count
       FROM fuel_entries f
       LEFT JOIN fuel_anomalies a ON a.fuel_entry_id = f.id
      WHERE f.vehicle_id = $1 AND f.deleted_at IS NULL
      GROUP BY f.id
      ORDER BY f.created_at DESC
      LIMIT $2`,
    [req.params.vehicleId, limit],
  );
  res.json({ data: result.rows });
}));

// GET /fuel/convoys/:convoyId — fuel for convoy
router.get('/convoys/:convoyId', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT f.*, v.registration AS vehicle_reg
       FROM fuel_entries f
       LEFT JOIN vehicles v ON v.id = f.vehicle_id
      WHERE f.convoy_id = $1 AND f.deleted_at IS NULL
      ORDER BY f.created_at DESC`,
    [req.params.convoyId],
  );
  res.json({ data: result.rows });
}));

module.exports = router;
