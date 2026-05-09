require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const { query } = require('../config/database');
const { getQueues } = require('../config/queue');
const { distanceToSegment } = require('../utils/haversine');
const logger = require('../utils/logger');

const SPEED_THRESHOLD = parseFloat(process.env.SPEED_ALERT_THRESHOLD) || 120;
const GEOFENCE_KM = parseFloat(process.env.GEOFENCE_RADIUS_KM) || 5;

let io = null;
function setIO(socketIO) { io = socketIO; }

function getRedisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return { host: url.hostname, port: parseInt(url.port) || 6379 };
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
  if (io) io.emit('vehicle:update', { vehicleId: vehicle_id, lat, lng, speed });

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

  logger.info(`GPS processed: vehicle=${vehicle_id} lat=${lat} lng=${lng} speed=${speed}`);
}

function startGPSWorker() {
  const connection = getRedisConnection();
  const worker = new Worker('gps', processGPS, { connection, concurrency: 10 });

  worker.on('completed', (job) => logger.info(`GPS job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`GPS job ${job?.id} failed: ${err.message}`));

  logger.info('GPS worker started');
  return worker;
}

module.exports = { startGPSWorker, setIO };
