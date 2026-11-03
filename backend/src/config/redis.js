require('dotenv').config();
const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;

function normalizeRedisUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return 'redis://127.0.0.1:6379';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `redis://${value}`;
}

function createRedisClient() {
  if (process.env.DISABLE_REDIS === 'true') {
    logger.warn('Redis disabled via DISABLE_REDIS=true. Queue workers will not start.');
    return null;
  }

  const client = new Redis(normalizeRedisUrl(process.env.REDIS_URL), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 10) {
        logger.error('Redis retry limit reached — giving up');
        return null;
      }
      return Math.min(times * 200, 3000);
    },
    lazyConnect: true,
  });

  client.on('connect', () => logger.info('Redis connected'));
  client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
  client.on('close', () => logger.warn('Redis connection closed'));

  return client;
}

function getRedis() {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

async function healthCheck() {
  const client = getRedis();
  if (!client) return 'disabled';
  try {
    const pong = await client.ping();
    return pong === 'PONG' ? 'ok' : 'degraded';
  } catch {
    return 'unreachable';
  }
}

module.exports = { getRedis, healthCheck, normalizeRedisUrl };
