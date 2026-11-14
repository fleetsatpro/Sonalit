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
    `-- Vehicle fixes: prefer the newest persisted GPS log over mutable vehicle cache.
      -- This survives delayed queue retries and out-of-order worker completion.
      SELECT
        v.id::text                          AS device_id,
        v.id::text                          AS vehicle_id,
        COALESCE(v.registration, '')        AS name,
        COALESCE(gl.lat, v.latitude)        AS lat,
        COALESCE(gl.lng, v.longitude)       AS lng,
        gl.speed                            AS speed,
        v.heading                           AS heading,
        COALESCE(gl.timestamp, v.last_ping) AS timestamp,
        COALESCE(v.last_ping, gl.timestamp) AS last_seen_at,
        NULL::numeric                       AS accuracy_m,
        'vehicle_gps'::text                 AS position_source,
        false                               AS panic_active,
        NULL::int                           AS battery_level,
        NULL::int                           AS signal_strength,
        NULL::timestamptz                   AS health_recorded_at,
        NULL::text                          AS officer_name,
        NULL::text                          AS officer_phone
      FROM vehicles v
      LEFT JOIN LATERAL (
        SELECT lat, lng, speed, timestamp
          FROM gps_logs
         WHERE vehicle_id = v.id
           AND org_id = v.org_id
         ORDER BY timestamp DESC, id DESC
         LIMIT 1
      ) gl ON true
      WHERE COALESCE(gl.lat, v.latitude) IS NOT NULL
        AND COALESCE(gl.lng, v.longitude) IS NOT NULL
        AND v.deleted_at IS NULL

      UNION ALL

      -- Guardian coordinates come from actual fix history. last_seen is a
      -- heartbeat timestamp and is deliberately not used as a GPS fix time.
      SELECT
        gd.id::text                         AS device_id,
        CASE WHEN gd.assignment_type = 'vehicle'
             THEN gd.assignment_id::text ELSE NULL END AS vehicle_id,
        COALESCE(gd.name, gd.id::text)       AS name,
        COALESCE(dl.lat, gd.last_lat)        AS lat,
        COALESCE(dl.lng, gd.last_lng)        AS lng,
        CASE
          WHEN dl.speed IS NOT NULL THEN dl.speed * 3.6
          WHEN gd.last_speed IS NOT NULL THEN gd.last_speed * 3.6
          ELSE NULL
        END                                 AS speed,
        dl.heading                          AS heading,
        COALESCE(dl.timestamp, gd.last_fix_at) AS timestamp,
        gd.last_seen                        AS last_seen_at,
        dl.accuracy                         AS accuracy_m,
        CASE WHEN dl.id IS NOT NULL THEN 'device_locations' ELSE 'last_fix_cache' END::text AS position_source,
        COALESCE(gd.panic_active, false)     AS panic_active,
        dh.battery_level                    AS battery_level,
        dh.signal_strength                  AS signal_strength,
        dh.recorded_at                      AS health_recorded_at,
        fo.name                             AS officer_name,
        fo.phone                            AS officer_phone
      FROM guardian_devices gd
      LEFT JOIN field_officers fo
        ON fo.device_id = gd.id AND fo.org_id = gd.org_id
      LEFT JOIN LATERAL (
        SELECT id, lat, lng, speed, heading, accuracy, timestamp
          FROM device_locations
         WHERE device_id = gd.id
         ORDER BY timestamp DESC, id DESC
         LIMIT 1
      ) dl ON true
      LEFT JOIN LATERAL (
        SELECT battery_level, signal_strength, recorded_at
          FROM device_health
         WHERE device_id = gd.id
         ORDER BY (battery_level IS NOT NULL) DESC, recorded_at DESC
         LIMIT 1
      ) dh ON true
      WHERE COALESCE(dl.lat, gd.last_lat) IS NOT NULL
        AND COALESCE(dl.lng, gd.last_lng) IS NOT NULL
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
