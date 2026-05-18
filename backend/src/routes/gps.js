const router = require('express').Router();
const Joi = require('joi');
const { getQueues } = require('../config/queue');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');

const gpsSchema = Joi.object({
  vehicle_id: Joi.string().required(),
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  speed: Joi.number().min(0).max(300).required(),
  timestamp: Joi.date().iso().default(() => new Date()),
});

router.post('/', asyncHandler(async (req, res) => {
  const { error, value } = gpsSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const { gpsQueue } = getQueues();

  if (!gpsQueue) {
    // Redis disabled — write directly (dev mode only)
    await query(
      'INSERT INTO gps_logs (vehicle_id, lat, lng, speed, timestamp) VALUES ($1,$2,$3,$4,$5)',
      [value.vehicle_id, value.lat, value.lng, value.speed, value.timestamp]
    );
    return res.status(202).json({ queued: false, direct: true });
  }

  const job = await gpsQueue.add('gps-update', value, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });

  res.status(202).json({ queued: true, jobId: job.id });
}));

// GET /gps?vehicle_id=&limit=  — query-param form used by the frontend
router.get('/', asyncHandler(async (req, res) => {
  const { vehicle_id } = req.query;
  if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id query parameter is required' });
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const result = await query(
    'SELECT * FROM gps_logs WHERE vehicle_id = $1 ORDER BY timestamp DESC LIMIT $2',
    [vehicle_id, limit]
  );
  res.json({ data: result.rows });
}));

// GET /gps/:vehicleId  — path-param form (legacy / IoT clients)
router.get('/:vehicleId', asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT * FROM gps_logs WHERE vehicle_id = $1 ORDER BY timestamp DESC LIMIT 200',
    [req.params.vehicleId]
  );
  res.json({ data: result.rows });
}));

module.exports = router;
