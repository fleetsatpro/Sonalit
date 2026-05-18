require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { startGPSWorker } = require('../src/workers/gpsWorker');
const { startAlertWorker } = require('../src/workers/alertWorker');
const { startNotificationWorker } = require('../src/workers/notificationWorker');
const { startConvoyReportWorker } = require('../src/workers/convoyReportWorker');
const { createQueues } = require('../src/config/queue');
const logger = require('../src/utils/logger');

if (process.env.DISABLE_REDIS === 'true') {
  logger.warn('DISABLE_REDIS=true — workers not started');
  process.exit(0);
}

// Initialise the producer queues so workers can enqueue downstream jobs.
createQueues();

const workers = [
  startGPSWorker(),
  startAlertWorker(),
  startNotificationWorker(),
  ...startConvoyReportWorker(),
];

logger.info(`✅ ${workers.length} workers running`);

const shutdown = async () => {
  logger.info('Shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
