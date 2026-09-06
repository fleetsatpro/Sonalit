require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const { sendEmail, isRetryableError } = require('../services/email/resend');
const { FROM, REPLY_TO } = require('../services/email/email.service');

function redisConnection() {
  const raw = process.env.REDIS_URL;
  if (!raw) throw new Error('REDIS_URL is not configured for the Resend email worker');
  const url = new URL(raw);
  const options = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    connectTimeout: 10000,
    retryStrategy: attempt => Math.min(1000 * Math.max(attempt, 1), 10000),
  };
  if (url.protocol === 'rediss:') options.tls = {};
  return new Redis(options);
}

async function processEmail(job) {
  const id = job.data?.emailNotificationId;
  if (!id) throw new Error('email.send job missing emailNotificationId');

  const claim = await query(
    `UPDATE email_notifications
     SET status='sending', attempts=attempts+1, last_attempt_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND status IN ('queued','delivery_delayed','failed')
     RETURNING *`,
    [id]
  );
  if (!claim.rows.length) {
    logger.warn(`Resend email job ${job.id} skipped: notification=${id} is not sendable (already claimed/completed)`);
    return;
  }

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

    await query(
      `UPDATE email_notifications
       SET status='sent', provider_email_id=$2, sent_at=NOW(), updated_at=NOW(), last_error=NULL
       WHERE id=$1`,
      [id, result.id]
    );
    logger.info(`Resend email accepted: notification=${id} provider=${result.id} recipient=${email.recipient}`);
  } catch (err) {
    const retryable = isRetryableError(err) && email.attempts < 8;
    await query(
      `UPDATE email_notifications
       SET status=$2,
           last_error=$3,
           failed_at=CASE WHEN $2='failed' THEN NOW() ELSE failed_at END,
           updated_at=NOW()
       WHERE id=$1`,
      [id, retryable ? 'delivery_delayed' : 'failed', String(err.message || err).slice(0, 2000)]
    );
    if (retryable) throw err;
    logger.error(`Permanent Resend email failure: notification=${id} recipient=${email.recipient} error=${err.message}`);
  }
}

function startResendEmailWorker() {
  const concurrency = Number(process.env.RESEND_EMAIL_CONCURRENCY) || 5;
  const connection = redisConnection();
  connection.on('connect', () => logger.info('Resend email Redis: TCP connection established'));
  connection.on('ready', () => logger.info('Resend email Redis: ready'));
  connection.on('error', err => logger.error(`Resend email Redis error: ${err.message}`));
  connection.on('close', () => logger.warn('Resend email Redis connection closed'));

  const worker = new Worker('email', processEmail, { connection, concurrency });
  logger.info(`Resend email worker starting: queue=email concurrency=${concurrency} from=${FROM}`);
  worker.on('ready', () => logger.info('Resend email worker ready: Redis connection established'));
  worker.on('completed', job => logger.info(`Resend email job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Resend email job ${job?.id} failed: ${err.message}`));
  worker.on('error', err => logger.error(`Resend email worker error: ${err.message}`));
  return worker;
}

module.exports = { startResendEmailWorker, processEmail };