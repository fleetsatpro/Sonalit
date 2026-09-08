require('dotenv').config();
const { runCollectionFabric } = require('../utils/collectionFabric');
const logger = require('../utils/logger');

const intervalMs = Math.max(5, Number(process.env.INTEL_COLLECTION_INTERVAL_MINUTES || 5)) * 60 * 1000;
let stopping = false;
let timer = null;

async function cycle(reason) {
  if (stopping) return;
  const started = Date.now();
  try {
    const result = await runCollectionFabric();
    const discovered = Number(result?.discovered || 0);
    const ingested = Number(result?.ingested || 0);
    logger.info(`Intelligence worker cycle complete (${reason}) in ${Date.now() - started}ms: orgs=${result?.organizations ?? 0}, discovered=${discovered}, ingested=${ingested}`);
  } catch (error) {
    logger.error(`Intelligence worker cycle failed (${reason}): ${error.message}`);
  }
}

function schedule() {
  if (stopping) return;
  // Keep the timer referenced. A Railway worker must remain alive between collection cycles.
  timer = setTimeout(async () => {
    await cycle('scheduled');
    schedule();
  }, intervalMs);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  logger.info(`Intelligence worker shutting down (${signal})`);
  try {
    const { pool } = require('../config/database');
    await pool.end();
  } catch (_) {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

(async () => {
  logger.info(`Intelligence worker online; collection cadence=${intervalMs / 60000}m`);
  await cycle('startup');
  schedule();
})();
