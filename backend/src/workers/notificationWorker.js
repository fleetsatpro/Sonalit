require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { queueAlertEmail } = require('../services/email/email.service');
const { generateAndQueueScopedClientPulse, listCustomerPulseTargets } = require('../services/email/scopedClientPulse.service');

const PULSE_HOURS_EAT = [0, 4, 8, 12, 16, 20];
const TZ_OFFSET_MINUTES = 180;

function eatSlot(date = new Date()) {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const eatMinutes = (utcMinutes + TZ_OFFSET_MINUTES) % 1440;
  return { hour: Math.floor(eatMinutes / 60), minute: eatMinutes % 60 };
}

async function processNotification(job) {
  const { alertId, severity } = job.data || {};
  if (!alertId) throw new Error('notification job missing alertId');
  const alertResult = await query(`SELECT a.*, v.registration, v.region, c.name AS convoy_name, c.org_id FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id LEFT JOIN convoys c ON c.id = a.convoy_id WHERE a.id = $1 LIMIT 1`, [alertId]);
  if (!alertResult.rows.length) { logger.warn(`Notification: alert ${alertId} not found`); return; }
  const alert = alertResult.rows[0];
  const orgId = alert.org_id;
  if (!orgId) throw new Error(`Alert ${alertId} has no organization scope`);

  const type = String(alert.type || '').toLowerCase();
  const routeSecurity = alert.security_event === true || type === 'security' || ['panic','sos','tamper','forced_unlock','unauthorized_movement'].includes(type);
  const eventType = routeSecurity ? 'fleet.security' : 'fleet.operational';

  // Internal Sonalit operators continue to receive operational/security alerts
  // by role. External recipients require explicit, active, verified enrollment
  // and an event/channel subscription; legacy boolean flags are not authority.
  const internal = await query(`SELECT email,name FROM users WHERE org_id=$1 AND role IN ('admin','dispatcher') AND status='active' AND deleted_at IS NULL AND email IS NOT NULL`, [orgId]);
  const external = await query(`
    SELECT DISTINCT r.email,r.name
      FROM communication_enrollments e
      JOIN communication_subscriptions s ON s.enrollment_id=e.id
      JOIN client_email_recipients r ON r.id=e.recipient_id
     WHERE e.org_id=$1 AND e.domain='fleet' AND e.status IN ('verified','active')
       AND r.org_id=$1 AND r.enabled=true AND r.deleted_at IS NULL
       AND s.org_id=$1 AND s.event_type=$2 AND s.channel='email' AND s.enabled=true`, [orgId, eventType]);
  const recipients = [...internal.rows, ...external.rows].filter((r, i, arr) => r.email && arr.findIndex(x => x.email.toLowerCase() === r.email.toLowerCase()) === i);
  if (!recipients.length) { logger.info(`Notification: no eligible recipients for alert ${alertId}`); return; }

  await queueAlertEmail({ orgId, recipients, alert: { ...alert, severity: severity || alert.severity }, correlationId: job.id ? `notification:${job.id}` : `alert:${alertId}`, ctaUrl: process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/alerts/${alertId}` : undefined });
  logger.info(`Notification fan-out queued: alert=${alertId} org=${orgId} event=${eventType} recipients=${recipients.length}`);
}

async function runScheduledClientPulse(now = new Date()) {
  const { hour, minute } = eatSlot(now);
  if (minute !== 0 || !PULSE_HOURS_EAT.includes(hour)) return { skipped: true, reason: 'not_pulse_slot' };
  const orgs = await query(`SELECT DISTINCT org_id FROM communication_enrollments WHERE domain='cds' AND status IN ('verified','active') AND cds_customer_id IS NOT NULL`);
  let queued = 0; let customers = 0;
  for (const { org_id: orgId } of orgs.rows) {
    try {
      const customerIds = await listCustomerPulseTargets(orgId);
      for (const customerId of customerIds) {
        customers++;
        try {
          const result = await generateAndQueueScopedClientPulse(orgId, customerId, { snapshotAt: now, reason: 'scheduled' });
          if (result?.queued) queued += result.queued;
        } catch (err) { logger.error(`Scheduled CDS Client Pulse failed: org=${orgId} customer=${customerId} error=${err.message}`); }
      }
    } catch (err) { logger.error(`Scheduled CDS Client Pulse target discovery failed: org=${orgId} error=${err.message}`); }
  }
  return { queued, organizations: orgs.rows.length, customers, hour };
}

function startClientPulseScheduler() {
  let lastMinuteKey = null;
  const tick = async () => { const now = new Date(); const key = now.toISOString().slice(0,16); if (key === lastMinuteKey) return; lastMinuteKey = key; try { await runScheduledClientPulse(now); } catch (err) { logger.error(`Client Pulse scheduler error: ${err.message}`); } };
  void tick();
  const timer = setInterval(() => { void tick(); }, 15000); timer.unref?.();
  logger.info('CDS Client Pulse scheduler started: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 EAT');
  return timer;
}

function startNotificationWorker() {
  const { Worker } = require('bullmq');
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  const connection = { host: url.hostname, port: Number(url.port) || 6379, password: url.password || process.env.REDIS_PASSWORD || undefined };
  const worker = new Worker('notification', async job => { if (job.name !== 'notify') return; return processNotification(job); }, { connection, concurrency: Number(process.env.NOTIFICATION_FANOUT_CONCURRENCY) || 3 });
  worker.on('completed', job => logger.info(`Notification fan-out job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Notification fan-out job ${job?.id} failed: ${err.message}`));
  worker.on('error', err => logger.error(`Notification worker error: ${err.message}`));
  logger.info('Notification fan-out worker started');
  startClientPulseScheduler();
  return worker;
}

module.exports = { startNotificationWorker, processNotification, runScheduledClientPulse, startClientPulseScheduler };
