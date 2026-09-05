require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { queueAlertEmail } = require('../services/email/email.service');
const { generateAndQueueClientPulse } = require('../services/email/clientPulse.service');

const PULSE_HOURS_EAT = [0, 4, 8, 12, 16, 20];
const TZ_OFFSET_MINUTES = 180;

function eatSlot(date = new Date()) {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const eatMinutes = (utcMinutes + TZ_OFFSET_MINUTES) % 1440;
  const hour = Math.floor(eatMinutes / 60);
  const minute = eatMinutes % 60;
  return { hour, minute };
}

async function processNotification(job) {
  const { alertId, severity } = job.data || {};
  if (!alertId) throw new Error('notification job missing alertId');

  const alertResult = await query(
    `SELECT a.*, v.registration, v.region, c.name AS convoy_name, c.org_id
       FROM alerts a
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN convoys c ON c.id = a.convoy_id
      WHERE a.id = $1 LIMIT 1`, [alertId]
  );
  if (!alertResult.rows.length) {
    logger.warn(`Notification: alert ${alertId} not found`);
    return;
  }

  const alert = alertResult.rows[0];
  const orgId = alert.org_id;
  if (!orgId) throw new Error(`Alert ${alertId} has no organization scope`);

  const routeSecurity = alert.security_event === true || alert.type === 'security' || ['panic', 'sos', 'tamper', 'forced_unlock', 'unauthorized_movement'].includes(String(alert.type || '').toLowerCase());
  const clientFlag = routeSecurity ? 'sonalit_security' : 'sonalit_operational';

  const recipients = await query(
    `SELECT email, name FROM users
      WHERE org_id = $1 AND role IN ('admin','dispatcher') AND status = 'active'
        AND deleted_at IS NULL AND email IS NOT NULL
     UNION
     SELECT email, name FROM client_email_recipients
      WHERE org_id = $1 AND enabled = true AND deleted_at IS NULL
        AND ${clientFlag} = true AND email IS NOT NULL`, [orgId]
  );
  if (!recipients.rows.length) {
    logger.info(`Notification: no eligible recipients for alert ${alertId}`);
    return;
  }

  await queueAlertEmail({
    orgId,
    recipients: recipients.rows,
    alert: { ...alert, severity: severity || alert.severity },
    correlationId: job.id ? `notification:${job.id}` : `alert:${alertId}`,
    ctaUrl: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/alerts/${alertId}` : undefined,
  });

  logger.info(`Notification fan-out queued: alert=${alertId} org=${orgId} recipients=${recipients.rows.length}`);
}

async function runScheduledClientPulse(now = new Date()) {
  const { hour, minute } = eatSlot(now);
  if (minute !== 0 || !PULSE_HOURS_EAT.includes(hour)) return { skipped: true, reason: 'not_pulse_slot' };

  const orgs = await query(`SELECT DISTINCT org_id FROM client_email_recipients WHERE enabled=true AND deleted_at IS NULL AND cds_client_pulse=true`);
  let queued = 0;
  for (const { org_id: orgId } of orgs.rows) {
    try {
      const result = await generateAndQueueClientPulse(orgId, { snapshotAt: now, slotKey: `${now.toISOString().slice(0,10)}-${String(hour).padStart(2,'0')}` });
      if (result?.queued) queued += result.queued;
    } catch (err) {
      logger.error(`Scheduled CDS Client Pulse failed: org=${orgId} error=${err.message}`);
    }
  }
  return { queued, organizations: orgs.rows.length, hour };
}

function startClientPulseScheduler() {
  let lastMinuteKey = null;
  const tick = async () => {
    const now = new Date();
    const key = `${now.toISOString().slice(0,16)}`;
    if (key === lastMinuteKey) return;
    lastMinuteKey = key;
    try { await runScheduledClientPulse(now); } catch (err) { logger.error(`Client Pulse scheduler error: ${err.message}`); }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 15000);
  timer.unref?.();
  logger.info('CDS Client Pulse scheduler started: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 EAT');
  return timer;
}

function startNotificationWorker() {
  const { Worker } = require('bullmq');
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  const connection = { host: url.hostname, port: Number(url.port) || 6379, password: url.password || process.env.REDIS_PASSWORD || undefined };
  const worker = new Worker('notification', async job => {
    if (job.name !== 'notify') return;
    return processNotification(job);
  }, { connection, concurrency: Number(process.env.NOTIFICATION_FANOUT_CONCURRENCY) || 3 });

  worker.on('completed', job => logger.info(`Notification fan-out job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Notification fan-out job ${job?.id} failed: ${err.message}`));
  worker.on('error', err => logger.error(`Notification worker error: ${err.message}`));
  logger.info('Notification fan-out worker started');
  startClientPulseScheduler();
  return worker;
}

module.exports = { startNotificationWorker, processNotification, runScheduledClientPulse, startClientPulseScheduler };
