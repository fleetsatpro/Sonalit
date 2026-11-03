require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');
const { pool } = require('../config/database');
const { createQueues } = require('../config/queue');
const { startGPSWorker } = require('./gpsWorker');

createQueues();
const worker = startGPSWorker();

async function shutdown() {
  logger.info('GPS worker shutting down');
  await worker.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
