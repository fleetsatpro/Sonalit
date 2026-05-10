require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const { query } = require('../config/database');
const { getQueues } = require('../config/queue');
const logger = require('../utils/logger');

const COOLDOWN_MINUTES = parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 10;

let io = null;
function setIO(socketIO) { io = socketIO; }

function getRedisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return { host: url.hostname, port: parseInt(url.port) || 6379 };
}

async function processAlert(job) {
  const { vehicle_id, convoy_id, type, severity, message } = job.data;

  // Deduplication: skip if same type for same vehicle within cooldown window
  const dupe = await query(
    `SELECT id FROM alerts
     WHERE vehicle_id = $1 AND type = $2 AND resolved_at IS NULL
       AND created_at > NOW() - INTERVAL '${COOLDOWN_MINUTES} minutes'
       AND deleted_at IS NULL
     LIMIT 1`,
    [vehicle_id, type]
  );

  if (dupe.rows.length) {
    logger.info(`Alert deduped (cooldown): vehicle=${vehicle_id} type=${type}`);
    return;
  }

  const result = await query(
    `INSERT INTO alerts (vehicle_id, convoy_id, type, severity, message, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) RETURNING *`,
    [vehicle_id, convoy_id || null, type, severity, message]
  );

  const alert = result.rows[0];

  if (io) {
    io.emit('alert:new', { alertId: alert.id, vehicleId: vehicle_id, type, severity, message });
  }

  const { notificationQueue } = getQueues();
  if (notificationQueue && (severity === 'high' || severity === 'critical')) {
    await notificationQueue.add('notify', { alertId: alert.id, severity });
  }

  logger.info(`Alert created: id=${alert.id} type=${type} severity=${severity}`);
}

function startAlertWorker() {
  const connection = getRedisConnection();
  const worker = new Worker('alert', processAlert, { connection, concurrency: 5 });

  worker.on('completed', (job) => logger.info(`Alert job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Alert job ${job?.id} failed: ${err.message}`));

  logger.info('Alert worker started');
  return worker;
}

module.exports = { startAlertWorker, setIO };
