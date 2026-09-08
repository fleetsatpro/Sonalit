require('dotenv').config();
const { runCollectionFabric } = require('../utils/collectionFabric');
const { runIncidentAlertSweep } = require('../utils/intelligenceAlertRuntime');
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
    let alertCount = 0;
    for (const org of result?.results || []) {
      if (!org?.org_id) continue;
      try {
        const alerts = await runIncidentAlertSweep(org.org_id);
        alertCount += Number(alerts?.totalAlerts || 0);
      } catch (error) {
        logger.warn(`Incident Alert Fabric failed for org=${org.org_id}: ${error.message}`);
      }
    }
    logger.info(`Intelligence worker cycle complete (${reason}) in ${Date.now() - started}ms: orgs=${result?.organizations ?? 0}, discovered=${discovered}, ingested=${ingested}, incident_alerts=${alertCount}`);
  } catch (error) {
    logger.error(`Intelligence worker cycle failed (${reason}): ${error.message}`);
  }
}

function schedule() {
  if (stopping) return;
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
  logger.info(`Intelligence worker online; collection cadence=${intervalMs / 60000}m; incident-alert cadence=${intervalMs / 60000}m`);
  await cycle('startup');
  schedule();
})();
