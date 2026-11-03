require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');
const { pool } = require('../config/database');
const { createQueues } = require('../config/queue');
const { startAlertWorker } = require('./alertWorker');

createQueues();
const worker = startAlertWorker();

async function shutdown() {
  logger.info('Alert worker shutting down');
  await worker.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
