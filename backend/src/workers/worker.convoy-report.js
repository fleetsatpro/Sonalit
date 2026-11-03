require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');
const { pool } = require('../config/database');
const { createQueues } = require('../config/queue');
const { startConvoyReportWorker } = require('./convoyReportWorker');

createQueues();
const workers = startConvoyReportWorker();

async function shutdown() {
  logger.info('Convoy-report worker shutting down');
  await Promise.all(workers.map(w => w.close()));
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
