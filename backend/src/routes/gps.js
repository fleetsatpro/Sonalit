const router = require('express').Router();
const Joi = require('joi');
const { getQueues } = require('../config/queue');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');

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
router.get('/track', authenticate, attachOrgDb, asyncHandler(async (req, res) => {
  const result = await req.db(
    `-- Vehicle positions (GPS worker writes here — primary source)
     SELECT
       v.id::text                         AS device_id,
       v.id::text                         AS vehicle_id,
       COALESCE(v.registration, '')       AS name,
       v.latitude                         AS lat,
       v.longitude                        AS lng,
       gl.speed                           AS speed,
       v.heading                          AS heading,
       COALESCE(v.last_ping, gl.timestamp) AS timestamp,
       false                               AS panic_active,
       NULL::int                          AS battery_level,
       NULL::int                          AS signal_strength
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
     -- guardian_devices has no heading column of its own (only last_lat/lng/
     -- speed/seen), so pull the most recent heading from the raw fix history
     -- device_locations instead — that's what makes a moving field officer's
     -- marker able to point in their direction of travel on the live map.
     -- panic_active and the latest device_health reading (battery/signal) are
     -- surfaced here too — the Live Fleet map previously had no way to show a
     -- field officer's SOS state or device health at all.
     SELECT
       gd.id::text                        AS device_id,
       CASE WHEN gd.assignment_type = 'vehicle'
            THEN gd.assignment_id::text ELSE NULL END AS vehicle_id,
       COALESCE(gd.name, gd.id::text)     AS name,
       gd.last_lat                        AS lat,
       gd.last_lng                        AS lng,
       gd.last_speed                      AS speed,
       dl.heading                         AS heading,
       gd.last_seen                       AS timestamp,
       COALESCE(gd.panic_active, false)   AS panic_active,
       dh.battery_level                   AS battery_level,
       dh.signal_strength                 AS signal_strength
     FROM guardian_devices gd
     LEFT JOIN LATERAL (
       SELECT heading FROM device_locations
       WHERE device_id = gd.id
       ORDER BY timestamp DESC LIMIT 1
     ) dl ON true
     LEFT JOIN LATERAL (
       SELECT battery_level, signal_strength FROM device_health
       WHERE device_id = gd.id
       ORDER BY (battery_level IS NOT NULL) DESC, recorded_at DESC LIMIT 1
     ) dh ON true
     WHERE gd.last_lat IS NOT NULL
       AND gd.last_lng IS NOT NULL
       AND gd.deleted_at IS NULL

     ORDER BY timestamp DESC NULLS LAST`,
    []
  );
  res.json(result.rows);
}));

// GET /gps?vehicle_id=&limit=  — query-param form used by the frontend
router.get('/', authenticate, attachOrgDb, asyncHandler(async (req, res) => {
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
router.get('/:vehicleId', authenticate, attachOrgDb, asyncHandler(async (req, res) => {
  const result = await req.db(
    'SELECT * FROM gps_logs WHERE vehicle_id = $1 ORDER BY timestamp DESC LIMIT 200',
    [req.params.vehicleId]
  );
  res.json({ data: result.rows });
}));

module.exports = router;
