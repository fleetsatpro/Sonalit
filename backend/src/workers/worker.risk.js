require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const { query, pool } = require('../config/database');
const logger = require('../utils/logger');

function getRedisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || process.env.REDIS_PASSWORD || undefined,
  };
}

async function processRiskStatsRefresh(job) {
  await query('REFRESH MATERIALIZED VIEW CONCURRENTLY risk_zone_stats');
  logger.info('risk_zone_stats materialized view refreshed');
  return { refreshed: true };
}

function startRiskWorker() {
  const connection = getRedisConnection();
  const worker = new Worker('risk-stats-refresh', processRiskStatsRefresh, {
    connection,
    concurrency: 1,
  });

  worker.on('completed', (job) => logger.info(`Risk stats job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Risk stats job ${job?.id} failed: ${err.message}`));
  worker.on('error', (err) => logger.error(`Risk stats worker error: ${err.message}`));

  logger.info('Risk stats worker started');
  return worker;
}

const worker = startRiskWorker();

async function shutdown() {
  logger.info('Risk stats worker shutting down');
  await worker.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
