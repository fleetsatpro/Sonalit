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

async function resolvePanicContext(panicId) {
  const result = await query(`
    SELECT p.id, p.org_id AS panic_org_id, p.device_id, p.lat, p.lng, p.message, p.created_at,
      d.name AS device_name, d.org_id AS device_org_id, d.client_id AS device_client_id,
      d.assignment_type, d.assignment_id, d.convoy_code,
      v.id AS vehicle_id, v.registration AS vehicle_registration, v.client_id AS vehicle_client_id,
      v.org_id AS vehicle_org_id, v.region AS vehicle_region, v.assigned_convoy_id,
      c.id AS convoy_id, c.name AS convoy_name, c.region AS convoy_region, c.status AS convoy_status,
      c.route_origin, c.route_destination
    FROM panic_events p
    LEFT JOIN guardian_devices d ON d.id=p.device_id AND d.deleted_at IS NULL
    LEFT JOIN vehicles v ON v.id=d.assignment_id
      AND lower(COALESCE(d.assignment_type,'')) IN ('vehicle','fleet_vehicle')
      AND v.deleted_at IS NULL
    LEFT JOIN convoys c ON c.id=v.assigned_convoy_id AND c.deleted_at IS NULL
    WHERE p.id=$1 LIMIT 1
  `, [panicId]);
  if (!result.rows.length || !result.rows[0].panic_org_id) return null;
  const event = result.rows[0];

  if (!event.convoy_id && event.vehicle_id) {
    const assignment = await query(`
      SELECT c.id, c.name, c.region, c.status, c.route_origin, c.route_destination
      FROM convoy_assignments ca JOIN convoys c ON c.id=ca.convoy_id
      WHERE ca.vehicle_id=$1 AND c.deleted_at IS NULL AND c.status IN ('active','planned')
      ORDER BY CASE WHEN c.status='active' THEN 0 ELSE 1 END, c.updated_at DESC LIMIT 1
    `, [event.vehicle_id]);
    if (assignment.rows.length) {
      const convoy = assignment.rows[0];
      event.convoy_id = convoy.id; event.convoy_name = convoy.name; event.convoy_region = convoy.region;
      event.convoy_status = convoy.status; event.route_origin = convoy.route_origin; event.route_destination = convoy.route_destination;
    }
  }

  event.client_id = event.device_client_id || event.vehicle_client_id || null;
  event.org_id = event.panic_org_id || event.device_org_id || event.vehicle_org_id;
  event.vehicle_display = event.vehicle_registration || event.device_name || event.device_id;
  event.region = event.convoy_region || event.vehicle_region || 'Unknown';
  return event;
}

async function dispatchPanicEmail(panicId) {
  const event = await resolvePanicContext(panicId);
  if (!event || !event.org_id) {
    logger.warn(`Panic email skipped: event=${panicId} missing event/org`);
    return { queued: 0, reason: 'missing_event_or_org' };
  }

  const recipients = await query(`
    SELECT DISTINCT ON (lower(trim(r.email))) r.email, r.name, r.authority_role, r.client_id
    FROM client_email_recipients r
    WHERE r.org_id=$1 AND r.deleted_at IS NULL AND r.enabled=TRUE AND r.sonalit_security=TRUE
      AND (r.authority_role IN ('super_admin','admin') OR
           (r.authority_role='client' AND $2::uuid IS NOT NULL AND r.client_id=$2::uuid))
    ORDER BY lower(trim(r.email)),
      CASE WHEN r.client_id=$2::uuid THEN 0 ELSE 1 END,
      CASE WHEN r.authority_role='super_admin' THEN 0 WHEN r.authority_role='admin' THEN 1 ELSE 2 END
  `, [event.org_id, event.client_id]);

  if (!recipients.rows.length) {
    logger.error(`Panic email has no eligible security recipients: event=${panicId} org=${event.org_id} client=${event.client_id || 'unassigned'}`);
    return { queued: 0, reason: 'no_security_recipients' };
  }

  const ownership = event.client_id ? `Client-owned asset: ${event.client_id}.` : 'Admin-owned/unassigned asset: global authority escalation only.';
  const convoy = event.convoy_name || (event.convoy_code ? `Code ${event.convoy_code}` : 'N/A');
  const route = event.route_origin || event.route_destination ? `${event.route_origin || '?'} → ${event.route_destination || '?'}` : 'N/A';

  const result = await queueAlertEmail({
    orgId: event.org_id,
    recipients: recipients.rows,
    correlationId: `panic:${panicId}`,
    ctaUrl: process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/panic-center` : undefined,
    alert: {
      id: event.id, type: 'panic', severity: 'critical', security_event: true,
      registration: event.vehicle_display,
      message: event.message || `Panic alarm triggered by ${event.vehicle_display}. Location: ${event.lat ?? 'unknown'}, ${event.lng ?? 'unknown'}.`,
      created_at: event.created_at,
      metadata: { vehicle_id: event.vehicle_id, device_id: event.device_id, client_id: event.client_id,
        convoy_id: event.convoy_id, convoy_name: convoy, convoy_status: event.convoy_status || 'N/A',
        region: event.region, route, ownership, coordinates: { lat: event.lat, lng: event.lng } },
    },
  });
  logger.warn(`Panic email dispatched: event=${panicId} queued=${result.queued} duplicate=${result.duplicate} recipients=${recipients.rows.length} client=${event.client_id || 'unassigned'} convoy=${event.convoy_id || event.convoy_code || 'none'} region=${event.region}`);
  return result;
}

async function backfillRecentPanics() {
  const recent = await query(`SELECT p.id FROM panic_events p WHERE p.created_at >= NOW() - INTERVAL '24 hours' AND NOT EXISTS (SELECT 1 FROM email_notifications e WHERE e.entity_id=p.id AND e.notification_type='security_incident') ORDER BY p.created_at DESC LIMIT 50`);
  for (const row of recent.rows) { try { await dispatchPanicEmail(row.id); } catch (err) { logger.error(`Panic email backfill failed: event=${row.id} error=${err.message}`); } }
  if (recent.rows.length) logger.warn(`Panic email backfill processed ${recent.rows.length} recent event(s)`);
}

async function startPanicEmailBridge() {
  const client = await pool.connect();
  await client.query('LISTEN sonalit_panic');
  logger.info('Panic email bridge ready: LISTEN sonalit_panic');
  client.on('notification', async (msg) => {
    if (msg.channel !== 'sonalit_panic') return;
    try { const payload = JSON.parse(msg.payload || '{}'); if (!payload.id) return; await dispatchPanicEmail(payload.id); }
    catch (err) { logger.error(`Panic email bridge failed: ${err.message}`); }
  });
  client.on('error', (err) => logger.error(`Panic email bridge PostgreSQL error: ${err.message}`));
  await backfillRecentPanics();
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

module.exports = { startResendEmailWorker, processEmail, dispatchPanicEmail, resolvePanicContext };
