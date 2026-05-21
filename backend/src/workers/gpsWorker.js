require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const { query } = require('../config/database');
const { getQueues } = require('../config/queue');
const { distanceToSegment } = require('../utils/haversine');
const logger = require('../utils/logger');

const SPEED_THRESHOLD = parseFloat(process.env.SPEED_ALERT_THRESHOLD) || 120;
const GEOFENCE_KM = parseFloat(process.env.GEOFENCE_RADIUS_KM) || 5;

// ── Corridor geofence cache (refreshed every 5 min) ───────────────────────
let _corridorCache = null;
let _corridorCacheTime = 0;

async function getCorridorGeofences() {
  if (_corridorCache && Date.now() - _corridorCacheTime < 300_000) return _corridorCache;
  try {
    const r = await query(
      `SELECT id, name, coordinates FROM geofences WHERE type = 'corridor' AND COALESCE(active, true) = true`
    );
    _corridorCache = r.rows.flatMap(f => {
      try {
        const c = typeof f.coordinates === 'string' ? JSON.parse(f.coordinates) : f.coordinates;
        if (!Array.isArray(c?.path) || c.path.length < 2) return [];
        return [{ id: f.id, name: f.name, path: c.path, buffer_km: (c.buffer_m || 300) / 1000 }];
      } catch (_) { return []; }
    });
    _corridorCacheTime = Date.now();
  } catch (_) { _corridorCache = _corridorCache || []; }
  return _corridorCache;
}

// Minimum distance from point to a multi-segment path, in km
function minDistToPathKm(lat, lng, path) {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distanceToSegment(lat, lng, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
    if (d < min) min = d;
  }
  return min === Infinity ? 0 : min;
}

const { publish } = require('../realtime/centrifugo');

function getRedisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || process.env.REDIS_PASSWORD || undefined,
  };
}

async function processGPS(job) {
  const { vehicle_id, lat, lng, speed, timestamp } = job.data;

  // 1. Store GPS log
  await query(
    'INSERT INTO gps_logs (vehicle_id, lat, lng, speed, timestamp) VALUES ($1,$2,$3,$4,$5)',
    [vehicle_id, lat, lng, speed, timestamp]
  );

  // 2. Update vehicle position
  await query(
    'UPDATE vehicles SET latitude=$1, longitude=$2, last_ping=$3, updated_at=NOW() WHERE id=$4',
    [lat, lng, new Date(timestamp), vehicle_id]
  );

  // 3. Broadcast live position
  publish('vehicle:update', { vehicleId: vehicle_id, lat, lng, speed });

  const { alertQueue } = getQueues();

  // 4. Speed check
  if (speed > SPEED_THRESHOLD && alertQueue) {
    await alertQueue.add('speed-alert', {
      vehicle_id, type: 'speed', severity: speed > 150 ? 'critical' : 'high',
      message: `Vehicle ${vehicle_id} travelling at ${speed} km/h — threshold is ${SPEED_THRESHOLD} km/h`,
    });
    logger.warn(`Speed alert queued for vehicle ${vehicle_id}: ${speed} km/h`);
  }

  // 5. Geofence check
  const convoyResult = await query(
    `SELECT c.route_origin, c.route_destination, c.id AS convoy_id
     FROM vehicles v
     JOIN convoys c ON c.id = v.assigned_convoy_id AND c.status = 'active' AND c.deleted_at IS NULL
     WHERE v.id = $1 AND v.deleted_at IS NULL`,
    [vehicle_id]
  );

  if (convoyResult.rows.length && alertQueue) {
    const convoy = convoyResult.rows[0];
    // Simple geocoding approximation — in production, integrate a geocoding service
    // For now use centre coordinates of named cities (covers East Africa operational area)
    const cityCoords = {
      'Nairobi': [-1.2921, 36.8219], 'Mombasa': [-4.0435, 39.6682],
      'Kampala': [0.3476, 32.5825], 'Dar es Salaam': [-6.7924, 39.2083],
      'Kinshasa': [-4.3217, 15.3215], 'Kigali': [-1.9441, 30.0619],
      'Bamako': [12.6392, -8.0029], 'Dodoma': [-6.1730, 35.7395],
    };

    const origin = cityCoords[convoy.route_origin];
    const dest = cityCoords[convoy.route_destination];

    if (origin && dest) {
      const deviation = distanceToSegment(lat, lng, origin[0], origin[1], dest[0], dest[1]);
      if (deviation > GEOFENCE_KM) {
        await alertQueue.add('geofence-alert', {
          vehicle_id, convoy_id: convoy.convoy_id, type: 'geofence',
          severity: deviation > GEOFENCE_KM * 2 ? 'critical' : 'high',
          message: `Vehicle ${vehicle_id} is ${deviation.toFixed(1)} km from convoy route (limit: ${GEOFENCE_KM} km)`,
        });
        logger.warn(`Geofence alert queued for vehicle ${vehicle_id}: ${deviation.toFixed(1)} km deviation`);
      }
    }
  }

  // 6. Corridor geofence deviation check
  if (alertQueue) {
    try {
      const corridors = await getCorridorGeofences();
      for (const fence of corridors) {
        const distKm = minDistToPathKm(lat, lng, fence.path);
        if (distKm > fence.buffer_km) {
          // Suppress duplicate: skip if unresolved deviation alert exists for this vehicle in last 30 min
          const dup = await query(
            `SELECT id FROM alerts WHERE vehicle_id = $1 AND type = 'route_deviation'
             AND resolved_at IS NULL AND created_at > NOW() - INTERVAL '30 minutes' LIMIT 1`,
            [vehicle_id]
          );
          if (!dup.rows.length) {
            const distM = Math.round(distKm * 1000);
            const limitM = Math.round(fence.buffer_km * 1000);
            await alertQueue.add('geofence-alert', {
              vehicle_id,
              geofence_id: fence.id,
              type: 'route_deviation',
              severity: distKm > fence.buffer_km * 4 ? 'critical' : 'high',
              message: `Vehicle ${vehicle_id} is ${distM}m off corridor "${fence.name}" (limit: ${limitM}m)`,
            });
            logger.warn(`Corridor deviation: vehicle=${vehicle_id} fence="${fence.name}" dist=${distM}m limit=${limitM}m`);
          }
        }
      }
    } catch (e) {
      logger.warn('Corridor check error: ' + e.message);
    }
  }

  logger.info(`GPS processed: vehicle=${vehicle_id} lat=${lat} lng=${lng} speed=${speed}`);
}

function startGPSWorker() {
  const connection = getRedisConnection();
  const worker = new Worker('gps', processGPS, { connection, concurrency: 10 });

  worker.on('completed', (job) => logger.info(`GPS job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`GPS job ${job?.id} failed: ${err.message}`));
  worker.on('error', (err) => logger.error(`GPS worker error: ${err.message}`));

  logger.info('GPS worker started');
  return worker;
}

module.exports = { startGPSWorker };
