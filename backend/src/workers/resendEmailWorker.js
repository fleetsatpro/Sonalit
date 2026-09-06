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

async function syncClientPulseRun(id, statusHint) {
  try {
    const result = await query(`
      UPDATE cds_client_pulse_runs r
      SET status = CASE
        WHEN $2='failed' THEN 'failed'
        WHEN x.total > 0 AND x.failed > 0 AND x.pending = 0 THEN 'failed'
        WHEN x.total > 0 AND x.pending = 0 AND x.failed = 0 THEN 'sent'
        ELSE r.status
      END,
      error = CASE WHEN $2='failed' THEN COALESCE(r.error,'Email delivery failed') ELSE r.error END,
      updated_at=NOW()
      FROM (
        SELECT en.correlation_id,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE en.status IN ('queued','sending','delivery_delayed'))::int AS pending,
               COUNT(*) FILTER (WHERE en.status='failed')::int AS failed
        FROM email_notifications en
        WHERE en.correlation_id IS NOT NULL
        GROUP BY en.correlation_id
      ) x
      WHERE r.id::text = regexp_replace(r.id::text,'^','')
        AND x.correlation_id = 'cds-client-pulse:' || r.id::text
        AND ($2='failed' OR (x.pending=0 AND (x.failed>0 OR x.total>0)))
      RETURNING r.id,r.status,x.total,x.pending,x.failed`, [id, statusHint || 'sent']);
    if (result.rows.length) {
      const row = result.rows[0];
      logger.info(`CDS Client Pulse run=${row.id} state=${row.status} notifications=${row.total} pending=${row.pending} failed=${row.failed}`);
    }
  } catch (err) {
    logger.warn(`CDS Client Pulse run state sync failed: run=${id} error=${err.message}`);
  }
}

async function processEmail(job) {
  const id = job.data?.emailNotificationId;
  if (!id) throw new Error('email.send job missing emailNotificationId');
  const claim = await query(`UPDATE email_notifications SET status='sending', attempts=attempts+1, last_attempt_at=NOW(), updated_at=NOW() WHERE id=$1 AND status IN ('queued','delivery_delayed','failed') AND attempts < 8 RETURNING *`, [id]);
  if (!claim.rows.length) {
    logger.warn(`Resend email job ${job.id || 'poll'} skipped: notification=${id} is not sendable`);
    return { skipped: true };
  }
  const email = claim.rows[0];
  try {
    const result = await sendEmail({
      from: email.sender || FROM, to: email.recipient, replyTo: email.reply_to || REPLY_TO,
      subject: email.subject, html: email.html_body, text: email.text_body,
      attachments: Array.isArray(email.attachments) ? email.attachments : [],
      idempotencyKey: email.idempotency_key,
      tags: [{ name:'notification_type', value:email.notification_type }, { name:'severity', value:email.severity }, { name:'org_id', value:email.org_id }],
    });
    await query(`UPDATE email_notifications SET status='sent', provider_email_id=$2, sent_at=NOW(), updated_at=NOW(), last_error=NULL WHERE id=$1`, [id, result.id]);
    logger.info(`Resend email accepted: notification=${id} provider=${result.id} recipient=${email.recipient}`);
    if (email.notification_type === 'cds_client_pulse' && email.correlation_id) await syncClientPulseRun(email.correlation_id.replace(/^cds-client-pulse:/,''), 'sent');
    return { sent: true, providerId: result.id };
  } catch (err) {
    const retryable = isRetryableError(err) && email.attempts < 8;
    await query(`UPDATE email_notifications SET status=$2,last_error=$3,failed_at=CASE WHEN $2='failed' THEN NOW() ELSE failed_at END,updated_at=NOW() WHERE id=$1`, [id, retryable ? 'delivery_delayed' : 'failed', String(err.message || err).slice(0, 2000)]);
    if (retryable) throw err;
    logger.error(`Permanent Resend email failure: notification=${id} recipient=${email.recipient} error=${err.message}`);
    if (email.notification_type === 'cds_client_pulse' && email.correlation_id) await syncClientPulseRun(email.correlation_id.replace(/^cds-client-pulse:/,''), 'failed');
    return { failed: true };
  }
}

let pollTimer = null;
let polling = false;
async function recoverQueuedEmails() {
  if (polling) return;
  polling = true;
  try {
    const result = await query(`SELECT id FROM email_notifications WHERE status IN ('queued','delivery_delayed') AND attempts < 8 ORDER BY created_at ASC LIMIT 25`);
    for (const row of result.rows) {
      try { await processEmail({ id:`recovery:${row.id}`, data:{ emailNotificationId:row.id } }); }
      catch (err) { logger.warn(`Email recovery attempt deferred: notification=${row.id} error=${err.message}`); }
    }
  } catch (err) { logger.error(`Email recovery sweep failed: ${err.message}`); }
  finally { polling = false; }
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
  recoverQueuedEmails();
  pollTimer = setInterval(recoverQueuedEmails, 5000);
  const close = worker.close.bind(worker);
  worker.close = async (...args) => { if (pollTimer) clearInterval(pollTimer); pollTimer=null; await connection.quit().catch(()=>{}); return close(...args); };
  return worker;
}
module.exports = { startResendEmailWorker, processEmail, recoverQueuedEmails };