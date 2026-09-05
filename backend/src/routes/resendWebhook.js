const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const MAX_SKEW_SECONDS = 300;
const STATUS_RANK = Object.freeze({ queued: 0, sending: 1, sent: 2, delivery_delayed: 2, delivered: 3, opened: 4, clicked: 5 });
const TERMINAL = new Set(['bounced', 'complained', 'suppressed', 'failed']);

function verifySignature(req) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const id = req.headers['svix-id'];
  const timestamp = req.headers['svix-timestamp'];
  const signatureHeader = req.headers['svix-signature'];
  if (!id || !timestamp || !signatureHeader || !req.rawBody) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS) return false;

  const signingSecret = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signed = `${id}.${timestamp}.${req.rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', signingSecret).update(signed).digest('base64');
  return signatureHeader.split(' ').some(part => {
    const value = part.startsWith('v1,') ? part.slice(3) : part;
    const a = Buffer.from(value), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

router.post('/', async (req, res) => {
  if (!verifySignature(req)) return res.status(401).json({ error: 'invalid_webhook_signature' });

  const event = req.body || {};
  const eventId = req.headers['svix-id'] || null;
  const type = event.type;
  const providerEmailId = event.data?.email_id || event.data?.id || null;
  if (!type || !providerEmailId || !eventId) return res.status(400).json({ error: 'invalid_webhook_payload' });

  const statusMap = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'delivery_delayed',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'failed',
    'email.suppressed': 'suppressed',
  };
  const status = statusMap[type];
  if (!status) return res.status(202).json({ accepted: true, ignored: true });

  try {
    const inserted = await query(
      `INSERT INTO resend_webhook_events (event_id, provider_email_id, event_type)
       VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId, providerEmailId, type]
    );
    if (!inserted.rows.length) return res.status(200).json({ received: true, duplicate: true });

    const current = await query(`SELECT id, status FROM email_notifications WHERE provider_email_id=$1 LIMIT 1`, [providerEmailId]);
    if (!current.rows.length) {
      logger.warn(`Resend webhook received before local email record: provider=${providerEmailId} type=${type}`);
      return res.status(200).json({ received: true, unmatched: true });
    }

    const row = current.rows[0];
    const currentRank = STATUS_RANK[row.status] ?? 0;
    const nextRank = STATUS_RANK[status] ?? 0;
    const shouldAdvance = TERMINAL.has(status)
      ? !TERMINAL.has(row.status)
      : !TERMINAL.has(row.status) && nextRank > currentRank;

    if (shouldAdvance) {
      await query(
        `UPDATE email_notifications
         SET status=$1,
             provider_event_id=COALESCE(provider_event_id,$2),
             delivered_at=CASE WHEN $1='delivered' THEN COALESCE(delivered_at,NOW()) ELSE delivered_at END,
             failed_at=CASE WHEN $1 IN ('failed','bounced','suppressed','complained') THEN COALESCE(failed_at,NOW()) ELSE failed_at END,
             updated_at=NOW()
         WHERE id=$3`,
        [status, eventId, row.id]
      );
    }

    logger.info(`Resend webhook processed: type=${type} provider=${providerEmailId} advanced=${shouldAdvance}`);
    return res.status(200).json({ received: true, advanced: shouldAdvance });
  } catch (err) {
    logger.error(`Resend webhook processing failed: ${err.message}`);
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }
});

module.exports = router;
