require('dotenv').config();
const { Queue } = require('bullmq');
const { getRedis } = require('./redis');
const logger = require('../utils/logger');

let gpsQueue = null;
let alertQueue = null;
let notificationQueue = null;
let convoyReportQueue = null;
let convoyArchiveQueue = null;

function getConnection() {
  const redis = getRedis();
  if (!redis) return null;
  return { host: redis.options?.host || '127.0.0.1', port: redis.options?.port || 6379, password: redis.options?.password || process.env.REDIS_PASSWORD || undefined };
}

function createQueues() {
  if (process.env.DISABLE_REDIS === 'true' || !process.env.REDIS_URL) {
    logger.warn('Queues disabled — REDIS_URL not set or DISABLE_REDIS=true');
    return;
  }

  const url = new URL(process.env.REDIS_URL);
  const connection = { host: url.hostname, port: parseInt(url.port) || 6379, password: url.password || process.env.REDIS_PASSWORD || undefined };

  const defaultJobOptions = {
    attempts: parseInt(process.env.MAX_QUEUE_RETRIES) || 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  };

  const onQueueError = (name) => (err) => logger.error(`Queue ${name} error: ${err.message}`);

  gpsQueue = new Queue('gps', { connection, defaultJobOptions });
  gpsQueue.on('error', onQueueError('gps'));
  alertQueue = new Queue('alert', { connection, defaultJobOptions });
  alertQueue.on('error', onQueueError('alert'));
  notificationQueue = new Queue('notification', {
    connection,
    defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
  });
  notificationQueue.on('error', onQueueError('notification'));
  convoyReportQueue = new Queue('convoyReport', { connection, defaultJobOptions });
  convoyReportQueue.on('error', onQueueError('convoyReport'));
  convoyArchiveQueue = new Queue('convoyArchive', { connection, defaultJobOptions });
  convoyArchiveQueue.on('error', onQueueError('convoyArchive'));

  logger.info('BullMQ queues initialised: gps, alert, notification, convoyReport, convoyArchive');
}

function getQueues() {
  return { gpsQueue, alertQueue, notificationQueue, convoyReportQueue, convoyArchiveQueue };
}

module.exports = { createQueues, getQueues };
