require('dotenv').config();
const { Queue } = require('bullmq');
const { getRedis } = require('./redis');
const logger = require('../utils/logger');

let gpsQueue = null;
let alertQueue = null;
let notificationQueue = null;

function getConnection() {
  const redis = getRedis();
  if (!redis) return null;
  return { host: redis.options?.host || '127.0.0.1', port: redis.options?.port || 6379 };
}

function createQueues() {
  if (process.env.DISABLE_REDIS === 'true') {
    logger.warn('Queues disabled — DISABLE_REDIS=true');
    return;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const url = new URL(redisUrl);
  const connection = { host: url.hostname, port: parseInt(url.port) || 6379, password: url.password || undefined };

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

  logger.info('BullMQ queues initialised: gps, alert, notification');
}

function getQueues() {
  return { gpsQueue, alertQueue, notificationQueue };
}

module.exports = { createQueues, getQueues };
