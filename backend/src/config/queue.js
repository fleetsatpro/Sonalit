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
  if (process.env.DISABLE_REDIS === 'true') {
    logger.warn('Queues disabled — DISABLE_REDIS=true');
    return;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const url = new URL(redisUrl);
  const connection = { host: url.hostname, port: parseInt(url.port) || 6379, password: url.password || process.env.REDIS_PASSWORD || undefined };

  const defaultJobOptions = {
    attempts: parseInt(process.env.MAX_QUEUE_RETRIES) || 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  };

  gpsQueue = new Queue('gps', { connection, defaultJobOptions });
  alertQueue = new Queue('alert', { connection, defaultJobOptions });
  notificationQueue = new Queue('notification', {
    connection,
    defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
  });
  convoyReportQueue = new Queue('convoyReport', { connection, defaultJobOptions });
  convoyArchiveQueue = new Queue('convoyArchive', { connection, defaultJobOptions });

  logger.info('BullMQ queues initialised: gps, alert, notification, convoyReport, convoyArchive');
}

function getQueues() {
  return { gpsQueue, alertQueue, notificationQueue, convoyReportQueue, convoyArchiveQueue };
}

module.exports = { createQueues, getQueues };
