require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { sendEmail, isRetryableError } = require('../services/email/resend');
const { FROM, REPLY_TO } = require('../services/email/email.service');

function redisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return { host: url.hostname, port: Number(url.port) || 6379, password: url.password || process.env.REDIS_PASSWORD || undefined };
}

async function processEmail(job) {
  const id = job.data?.emailNotificationId;
  if (!id) throw new Error('email.send job missing emailNotificationId');

  const claim = await query(
    `UPDATE email_notifications
        SET status='sending', attempts=attempts+1, last_attempt_at=NOW(), updated_at=NOW()
      WHERE id=$1 AND status IN ('queued','delivery_delayed','failed')
      RETURNING *`, [id]
  );
  if (!claim.rows.length) return;
  const email = claim.rows[0];

  try {
    const result = await sendEmail({
      from: FROM,
      to: email.recipient,
      replyTo: REPLY_TO,
      subject: email.subject,
      html: email.html_body,
      text: email.text_body,
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
    await query(
      `UPDATE email_notifications SET status=$2, last_error=$3, failed_at=CASE WHEN $2='failed' THEN NOW() ELSE failed_at END, updated_at=NOW() WHERE id=$1`,
      [id, retryable ? 'delivery_delayed' : 'failed', String(err.message || err).slice(0, 2000)]
    );
    if (retryable) throw err;
    logger.error(`Permanent Resend email failure: notification=${id} error=${err.message}`);
  }
}

function startResendEmailWorker() {
  const worker = new Worker('email', processEmail, {
    connection: redisConnection(),
    concurrency: Number(process.env.RESEND_EMAIL_CONCURRENCY) || 5,
  });
  worker.on('ready', () => logger.info(`Resend email worker ready: queue=email concurrency=${Number(process.env.RESEND_EMAIL_CONCURRENCY) || 5} from=${FROM}`));
  worker.on('completed', job => logger.info(`Resend email job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Resend email job ${job?.id} failed: ${err.message}`));
  worker.on('error', err => logger.error(`Resend email worker error: ${err.message}`));
  return worker;
}

module.exports = { startResendEmailWorker, processEmail };
