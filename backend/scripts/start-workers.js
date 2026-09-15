require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { spawn } = require('child_process');
const path = require('path');
const { startGPSWorker } = require('../src/workers/gpsWorker');
const { startAlertWorker } = require('../src/workers/alertWorker');
const { startNotificationWorker } = require('../src/workers/notificationWorker');
const { startConvoyReportWorker } = require('../src/workers/convoyReportWorker');
const { createQueues } = require('../src/config/queue');
const { query } = require('../src/config/database');
const { processBatch: processWorldStateBatch } = require('../src/services/geofence/worldStateWorker');
const logger = require('../src/utils/logger');

// Intelligence publications are intentionally independent of Redis. They must
// continue generating even when queue workers are disabled or Redis is unavailable.
const intelligenceWorker = spawn(process.execPath, [path.resolve(__dirname, '../src/workers/worker.intelligence.js')], { stdio: 'inherit', env: process.env });
intelligenceWorker.on('error', (error) => { logger.error(`Intelligence worker failed to start: ${error.message}`); });
intelligenceWorker.on('exit', (code, signal) => { if (!shuttingDown) { logger.error(`Intelligence worker exited unexpectedly code=${code ?? 'null'} signal=${signal ?? 'none'}`); process.exitCode = 1; } });

let workers = [];
let shuttingDown = false;
let worldStateTimer = null;
let worldStateBusy = false;

async function worldStateTick() {
  if (worldStateBusy || shuttingDown || process.env.DISABLE_WORLD_STATE_RECONCILIATION === 'true') return;
  worldStateBusy = true;
  try {
    const results = await processWorldStateBatch({ db: query, limit: Number(process.env.WORLD_STATE_BATCH_SIZE || 10) });
    if (results.length) logger.info(`4D world-state reconciliation processed ${results.length} task(s)`);
  } catch (error) {
    logger.warn(`4D world-state reconciliation tick failed: ${error.message}`);
  } finally {
    worldStateBusy = false;
  }
}

if (process.env.DISABLE_WORLD_STATE_RECONCILIATION !== 'true') {
  worldStateTimer = setInterval(worldStateTick, Number(process.env.WORLD_STATE_INTERVAL_MS || 5000));
  worldStateTick();
}

if (process.env.DISABLE_REDIS === 'true') {
  logger.warn('DISABLE_REDIS=true — Redis-backed workers not started; intelligence worker remains active');
} else {
  createQueues();
  workers = [startGPSWorker(), startAlertWorker(), startNotificationWorker(), ...startConvoyReportWorker()];
  logger.info(`✅ ${workers.length} Redis-backed workers running`);
}

logger.info('✅ Autonomous intelligence worker running');

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down workers...');
  if (worldStateTimer) clearInterval(worldStateTimer);
  if (intelligenceWorker && !intelligenceWorker.killed) intelligenceWorker.kill('SIGTERM');
  await Promise.allSettled(workers.map((w) => w.close()));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
