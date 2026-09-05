require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { queueAlertEmail } = require('../services/email/email.service');

async function processNotification(job) {
  // Backward-compatible adapter: alertWorker already publishes `notify` jobs.
  // Convert those legacy jobs into durable per-recipient Resend jobs rather
  // than sending SMTP directly. The actual provider call happens in the
  // dedicated resendEmailWorker handler for `email.send` jobs.
  const { alertId, severity } = job.data || {};
  if (!alertId) throw new Error('notification job missing alertId');

  const alertResult = await query(
    `SELECT a.*, v.registration, v.region, c.name AS convoy_name, c.org_id
       FROM alerts a
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN convoys c ON c.id = a.convoy_id
      WHERE a.id = $1
      LIMIT 1`, [alertId]
  );
  if (!alertResult.rows.length) {
    logger.warn(`Notification: alert ${alertId} not found`);
    return;
  }

  const alert = alertResult.rows[0];
  const orgId = alert.org_id;
  if (!orgId) throw new Error(`Alert ${alertId} has no organization scope`);

  const recipients = await query(
    `SELECT email, name
       FROM users
      WHERE org_id = $1
        AND role IN ('admin', 'dispatcher')
        AND status = 'active'
        AND deleted_at IS NULL
        AND email IS NOT NULL`, [orgId]
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

function startNotificationWorker() {
  // This worker intentionally handles the existing `notify` job type. A
  // separate resendEmailWorker handles `email.send` jobs on the same queue.
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
  return worker;
}

module.exports = { startNotificationWorker, processNotification };
