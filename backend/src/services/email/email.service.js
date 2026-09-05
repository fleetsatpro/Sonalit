const crypto = require('crypto');
const { getQueues } = require('../../config/queue');
const { withOrg } = require('../../utils/orgScopedDb');
const logger = require('../../utils/logger');
const { alertTemplate, genericTemplate } = require('./templates');

const FROM = process.env.RESEND_FROM_EMAIL || 'Sonalit <notifications@sonalit.com>';
const REPLY_TO = process.env.RESEND_REPLY_TO || undefined;
function normalizeRecipients(recipients) { return [...new Set((Array.isArray(recipients) ? recipients : [recipients]).filter(Boolean).map(String).map(s => s.trim().toLowerCase()))]; }
function stableKey(input) { return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'); }

async function enqueueEmail({ orgId, to, recipientName, notificationType, severity = 'normal', entityType, entityId, correlationId, idempotencyKey, templateData }) {
  if (!orgId) throw new Error('orgId is required for email enqueue');
  const recipients = normalizeRecipients(to);
  if (!recipients.length) return { queued: 0, duplicate: 0 };
  if (!process.env.RESEND_API_KEY) throw new Error('Email provider is not configured');
  const rendered = templateData?.alertType ? alertTemplate(templateData) : genericTemplate(templateData);
  const queue = getQueues().notificationQueue;
  if (!queue) throw new Error('Notification queue is unavailable; refusing to drop email');
  let queued = 0; let duplicate = 0;
  for (const recipient of recipients) {
    // Idempotency is per recipient. Reusing one alert key for all recipients
    // would incorrectly suppress every recipient after the first insert.
    const key = idempotencyKey ? stableKey({ base: idempotencyKey, recipient }) : stableKey({ orgId, recipient, notificationType, entityType, entityId, subject: rendered.subject });
    const inserted = await withOrg(orgId, client => client.query(
      `INSERT INTO email_notifications (org_id, recipient, recipient_name, notification_type, severity, subject, text_body, html_body, entity_type, entity_id, correlation_id, idempotency_key, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued') ON CONFLICT (org_id, idempotency_key) DO NOTHING RETURNING id`,
      [orgId, recipient, recipientName || null, notificationType, severity, rendered.subject, rendered.text, rendered.html, entityType || null, entityId || null, correlationId || null, key]
    ));
    if (!inserted.rows.length) { duplicate++; continue; }
    await queue.add('email.send', { emailNotificationId: inserted.rows[0].id }, { jobId: `email:${inserted.rows[0].id}`, priority: severity === 'critical' ? 1 : severity === 'high' ? 2 : 5, attempts: 8, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { count: 1000 }, removeOnFail: false });
    queued++;
  }
  return { queued, duplicate };
}

async function queueAlertEmail({ orgId, recipients, alert, correlationId, ctaUrl }) {
  return enqueueEmail({ orgId, to: recipients.map(r => r.email || r), notificationType: 'operational_alert', severity: alert.severity, entityType: 'alert', entityId: alert.id, correlationId, idempotencyKey: `alert:${alert.id}`, templateData: { alertType: alert.type, severity: alert.severity, vehicle: alert.registration, region: alert.region, convoy: alert.convoy_name, message: alert.message, time: alert.created_at, ctaLabel: 'Open alert', ctaUrl } });
}
module.exports = { enqueueEmail, queueAlertEmail, stableKey, FROM, REPLY_TO };
