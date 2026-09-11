require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { spawn } = require('child_process');
const path = require('path');
const { startGPSWorker } = require('../src/workers/gpsWorker');
const { startAlertWorker } = require('../src/workers/alertWorker');
const { startNotificationWorker } = require('../src/workers/notificationWorker');
const { startConvoyReportWorker } = require('../src/workers/convoyReportWorker');
const { createQueues } = require('../src/config/queue');
const logger = require('../src/utils/logger');

// Intelligence publications are intentionally independent of Redis. They must
// continue generating even when queue workers are disabled or Redis is unavailable.
const intelligenceWorker = spawn(
  process.execPath,
  [path.resolve(__dirname, '../src/workers/worker.intelligence.js')],
  { stdio: 'inherit', env: process.env }
);

intelligenceWorker.on('error', (error) => {
  logger.error(`Intelligence worker failed to start: ${error.message}`);
});
intelligenceWorker.on('exit', (code, signal) => {
  if (!shuttingDown) {
    logger.error(`Intelligence worker exited unexpectedly code=${code ?? 'null'} signal=${signal ?? 'none'}`);
    process.exitCode = 1;
  }
});

let workers = [];
let shuttingDown = false;

if (process.env.DISABLE_REDIS === 'true') {
  logger.warn('DISABLE_REDIS=true — Redis-backed workers not started; intelligence worker remains active');
} else {
  // Initialise the producer queues so workers can enqueue downstream jobs.
  createQueues();

  workers = [
    startGPSWorker(),
    startAlertWorker(),
    startNotificationWorker(),
    ...startConvoyReportWorker(),
  ];

  logger.info(`✅ ${workers.length} Redis-backed workers running`);
}

logger.info('✅ Autonomous intelligence worker running');

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down workers...');

  if (intelligenceWorker && !intelligenceWorker.killed) {
    intelligenceWorker.kill('SIGTERM');
  }

  await Promise.allSettled(workers.map((w) => w.close()));
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
