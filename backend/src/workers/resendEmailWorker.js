require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const { pool, query } = require('../config/database');
const logger = require('../utils/logger');
const { sendEmail, isRetryableError } = require('../services/email/resend');
const { FROM, REPLY_TO, queueAlertEmail } = require('../services/email/email.service');

function redisConnection() { const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379'); return { host: url.hostname, port: Number(url.port) || 6379, password: url.password || process.env.REDIS_PASSWORD || undefined }; }

async function processEmail(job) {
  const id = job.data?.emailNotificationId;
  if (!id) throw new Error('email.send job missing emailNotificationId');
  const claim = await query(`UPDATE email_notifications SET status='sending', attempts=attempts+1, last_attempt_at=NOW(), updated_at=NOW() WHERE id=$1 AND status IN ('queued','delivery_delayed','failed') RETURNING *`, [id]);
  if (!claim.rows.length) return;
  const email = claim.rows[0];
  try {
    const result = await sendEmail({
      from: email.sender || FROM,
      to: email.recipient,
      replyTo: email.reply_to || REPLY_TO,
      subject: email.subject,
      html: email.html_body,
      text: email.text_body,
      attachments: Array.isArray(email.attachments) ? email.attachments : [],
      idempotencyKey: email.idempotency_key,
      tags: [
        { name: 'notification_type', value: email.notification_type },
        { name: 'severity', value: email.severity },
        { name: 'org_id', value: email.org_id },
      ],
    });
    await query(`UPDATE email_notifications SET status='sent', provider_email_id=$2, sent_at=NOW(), updated_at=NOW(), last_error=NULL WHERE id=$1`, [id, result.id]);
    logger.info(`Resend email accepted: notification=${id} provider=${result.id}`);
  } catch (err) {
    const retryable = isRetryableError(err) && email.attempts < 8;
    await query(`UPDATE email_notifications SET status=$2, last_error=$3, failed_at=CASE WHEN $2='failed' THEN NOW() ELSE failed_at END, updated_at=NOW() WHERE id=$1`, [id, retryable ? 'delivery_delayed' : 'failed', String(err.message || err).slice(0, 2000)]);
    if (retryable) throw err;
    logger.error(`Permanent Resend email failure: notification=${id} error=${err.message}`);
  }
}

async function dispatchPanicEmail(panicId) {
  const panic = await query(`
    SELECT p.id, p.org_id, p.device_id, p.lat, p.lng, p.message, p.created_at,
           d.name AS device_name
    FROM panic_events p
    LEFT JOIN guardian_devices d ON d.id=p.device_id
    WHERE p.id=$1
    LIMIT 1
  `, [panicId]);
  if (!panic.rows.length || !panic.rows[0].org_id) {
    logger.warn(`Panic email skipped: event=${panicId} missing event/org`);
    return { queued: 0, reason: 'missing_event_or_org' };
  }
  const event = panic.rows[0];
  const recipients = await query(`
    SELECT email, name
    FROM client_email_recipients
    WHERE org_id=$1
      AND deleted_at IS NULL
      AND enabled=TRUE
      AND sonalit_security=TRUE
      AND authority_role IN ('super_admin','admin')
  `, [event.org_id]);
  if (!recipients.rows.length) {
    logger.error(`Panic email has no eligible authority recipients: event=${panicId} org=${event.org_id}`);
    return { queued: 0, reason: 'no_authority_recipients' };
  }

  const result = await queueAlertEmail({
    orgId: event.org_id,
    recipients: recipients.rows,
    correlationId: `panic:${panicId}`,
    ctaUrl: process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/panic-center` : undefined,
    alert: {
      id: event.id,
      type: 'panic',
      severity: 'critical',
      security_event: true,
      registration: event.device_name || event.device_id,
      message: event.message || `Panic alarm triggered by ${event.device_name || event.device_id}. Location: ${event.lat ?? 'unknown'}, ${event.lng ?? 'unknown'}.`,
      created_at: event.created_at,
    },
  });
  logger.warn(`Panic email dispatched: event=${panicId} queued=${result.queued} duplicate=${result.duplicate} recipients=${recipients.rows.length}`);
  return result;
}

async function startPanicEmailBridge() {
  const client = await pool.connect();
  await client.query('LISTEN sonalit_panic');
  logger.info('Panic email bridge ready: LISTEN sonalit_panic');
  client.on('notification', async (msg) => {
    if (msg.channel !== 'sonalit_panic') return;
    try {
      const payload = JSON.parse(msg.payload || '{}');
      if (!payload.id) return;
      await dispatchPanicEmail(payload.id);
    } catch (err) {
      logger.error(`Panic email bridge failed: ${err.message}`);
    }
  });
  client.on('error', (err) => logger.error(`Panic email bridge PostgreSQL error: ${err.message}`));
}

function startResendEmailWorker() {
  const concurrency = Number(process.env.RESEND_EMAIL_CONCURRENCY) || 5;
  const worker = new Worker('email', processEmail, { connection: redisConnection(), concurrency });
  logger.info(`Resend email worker starting: queue=email concurrency=${concurrency} from=${FROM}`);
  worker.on('ready', () => logger.info('Resend email worker ready: Redis connection established'));
  worker.on('completed', job => logger.info(`Resend email job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Resend email job ${job?.id} failed: ${err.message}`));
  worker.on('error', err => logger.error(`Resend email worker error: ${err.message}`));
  startPanicEmailBridge().catch(err => logger.error(`Panic email bridge startup failed: ${err.message}`));
  return worker;
}

module.exports = { startResendEmailWorker, processEmail, dispatchPanicEmail };
