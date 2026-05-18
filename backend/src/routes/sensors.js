const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
router.use(authenticate);
router.post('/', async (req, res, next) => {
  try {
    const { vehicle_id, temperature, humidity, shock_g, timestamp } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id required' });
    await query('INSERT INTO sensor_logs (vehicle_id, temperature, humidity, shock_g, raw_payload, timestamp) VALUES ($1,$2,$3,$4,$5,$6)',
      [vehicle_id, temperature, humidity, shock_g, JSON.stringify(req.body), timestamp ? new Date(timestamp) : new Date()]);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});
router.get('/:vehicleId', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM sensor_logs WHERE vehicle_id=$1 ORDER BY timestamp DESC LIMIT 20', [req.params.vehicleId]);
    res.json({ data: r.rows });
  } catch (err) { next(err); }
});
router.get('/:vehicleId/latest', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM sensor_logs WHERE vehicle_id=$1 ORDER BY timestamp DESC LIMIT 1', [req.params.vehicleId]);
    res.json({ data: r.rows[0] || null });
  } catch (err) { next(err); }
});
module.exports = router;
