const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const MAX_SKEW_SECONDS = 300;

function verifySignature(req) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const id = req.headers['svix-id'];
  const timestamp = req.headers['svix-timestamp'];
  const signatureHeader = req.headers['svix-signature'];
  if (!id || !timestamp || !signatureHeader || !req.rawBody) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS) return false;

  const encodedSecret = secret.replace(/^whsec_/, '');
  const signingSecret = Buffer.from(encodedSecret, 'base64');
  const signed = `${id}.${timestamp}.${req.rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', signingSecret).update(signed).digest('base64');

  return signatureHeader.split(' ').some(part => {
    const value = part.startsWith('v1,') ? part.slice(3) : part;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

router.post('/', async (req, res) => {
  if (!verifySignature(req)) return res.status(401).json({ error: 'invalid_webhook_signature' });

  const event = req.body || {};
  const eventId = req.headers['svix-id'] || null;
  const type = event.type;
  const providerEmailId = event.data?.email_id || event.data?.id || null;
  if (!type || !providerEmailId) return res.status(400).json({ error: 'invalid_webhook_payload' });

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
    // The provider email id is globally unique for the Resend account. The
    // event id is also unique; both are guarded to make webhook redelivery safe.
    const updated = await query(
      `UPDATE email_notifications
          SET status=$1,
              provider_event_id=COALESCE(provider_event_id,$2),
              delivered_at=CASE WHEN $1='delivered' THEN COALESCE(delivered_at,NOW()) ELSE delivered_at END,
              failed_at=CASE WHEN $1 IN ('failed','bounced','suppressed','complained') THEN COALESCE(failed_at,NOW()) ELSE failed_at END,
              updated_at=NOW()
        WHERE provider_email_id=$3
        RETURNING id`, [status, eventId, providerEmailId]
    );

    logger.info(`Resend webhook processed: type=${type} provider=${providerEmailId} updated=${updated.rows.length}`);
    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error(`Resend webhook processing failed: ${err.message}`);
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }
});

module.exports = router;
