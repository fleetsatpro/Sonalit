require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');
const { pool, query } = require('../config/database');
const { createQueues } = require('../config/queue');
const { startNotificationWorker } = require('./notificationWorker');
const { startResendEmailWorker } = require('./resendEmailWorker');
const { generateAndQueueClientPulse } = require('../services/email/clientPulse.service');

createQueues();
const fanoutWorker = startNotificationWorker();
const resendWorker = startResendEmailWorker();
let pulseTimer = null;

function scheduleNextClientPulse() {
  if (process.env.CDS_CLIENT_PULSE_ENABLED === 'false') return;
  const targetHour = Math.min(23, Math.max(0, Number(process.env.CDS_CLIENT_PULSE_UTC_HOUR ?? 11)));
  const targetMinute = Math.min(59, Math.max(0, Number(process.env.CDS_CLIENT_PULSE_UTC_MINUTE ?? 0)));
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(targetHour, targetMinute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - now.getTime();
  pulseTimer = setTimeout(async () => {
    try {
      const orgs = await query(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);
      for (const row of orgs.rows) {
        try { await generateAndQueueClientPulse(row.org_id, { snapshotAt: new Date() }); }
        catch (err) { logger.error(`CDS Client Pulse org run failed: org=${row.org_id} error=${err.message}`); }
      }
    } catch (err) {
      logger.error(`CDS Client Pulse scheduler failed: ${err.message}`);
    } finally {
      scheduleNextClientPulse();
    }
  }, delay);
  pulseTimer.unref?.();
  logger.info(`CDS Client Pulse scheduled: next=${next.toISOString()} enabled=${process.env.CDS_CLIENT_PULSE_ENABLED !== 'false'}`);
}

scheduleNextClientPulse();

async function shutdown() {
  logger.info('Notification/email workers shutting down');
  if (pulseTimer) clearTimeout(pulseTimer);
  await Promise.all([fanoutWorker.close().catch(() => {}), resendWorker.close().catch(() => {})]);
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
