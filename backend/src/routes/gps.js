const router = require('express').Router();
const Joi = require('joi');
const { getQueues } = require('../config/queue');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const { authenticate } = require('../middleware/auth');

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

// GET /gps/track — current live snapshot of all device positions for the org
router.get('/track', authenticate, asyncHandler(async (req, res) => {
  const result = await req.db(
    `-- Vehicle positions (GPS worker writes here — primary source)
     SELECT
       v.id::text                         AS device_id,
       v.id::text                         AS vehicle_id,
       v.latitude                         AS lat,
       v.longitude                        AS lng,
       gl.speed                           AS speed,
       v.heading                          AS heading,
       COALESCE(v.last_ping, gl.timestamp) AS timestamp
     FROM vehicles v
     LEFT JOIN LATERAL (
       SELECT speed, timestamp FROM gps_logs
       WHERE vehicle_id = v.id
       ORDER BY timestamp DESC LIMIT 1
     ) gl ON true
     WHERE v.latitude IS NOT NULL
       AND v.longitude IS NOT NULL
       AND v.deleted_at IS NULL

     UNION ALL

     -- Guardian handheld devices (IoT path — secondary source)
     SELECT
       gd.id::text                        AS device_id,
       CASE WHEN gd.assignment_type = 'vehicle'
            THEN gd.assignment_id::text ELSE NULL END AS vehicle_id,
       gd.last_lat                        AS lat,
       gd.last_lng                        AS lng,
       gd.last_speed                      AS speed,
       NULL::numeric                      AS heading,
       gd.last_seen                       AS timestamp
     FROM guardian_devices gd
     WHERE gd.last_lat IS NOT NULL
       AND gd.last_lng IS NOT NULL
       AND gd.deleted_at IS NULL

     ORDER BY timestamp DESC NULLS LAST`,
    []
  );
  res.json(result.rows);
}));

// GET /gps?vehicle_id=&limit=  — query-param form used by the frontend
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { vehicle_id } = req.query;
  if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id query parameter is required' });
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const result = await req.db(
    'SELECT * FROM gps_logs WHERE vehicle_id = $1 ORDER BY timestamp DESC LIMIT $2',
    [vehicle_id, limit]
  );
  res.json({ data: result.rows });
}));

// GET /gps/:vehicleId  — path-param form (legacy / IoT clients)
router.get('/:vehicleId', authenticate, asyncHandler(async (req, res) => {
  const result = await req.db(
    'SELECT * FROM gps_logs WHERE vehicle_id = $1 ORDER BY timestamp DESC LIMIT 200',
    [req.params.vehicleId]
  );
  res.json({ data: result.rows });
}));

module.exports = router;
