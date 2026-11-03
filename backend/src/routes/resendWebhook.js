const router = require('express').Router();
const crypto = require('crypto');
const { globalQuery } = require('../config/database');
const { withOrg } = require('../utils/orgScopedDb');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');
const { verifySecurityMapToken, renderSecurityMap } = require('../services/securityIncidentMap');

const MAX_SKEW_SECONDS = 300;
const STATUS_RANK = Object.freeze({ queued: 0, sending: 1, sent: 2, delivery_delayed: 2, delivered: 3, opened: 4, clicked: 5 });
const TERMINAL = new Set(['bounced', 'complained', 'suppressed', 'failed']);

const securityMapLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => res.status(429).send('Too many map requests') });

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

router.get('/security-map/:panicId', securityMapLimiter, async (req, res) => {
  const panicId = String(req.params.panicId || '');
  if (!verifySecurityMapToken(String(req.query.token || ''), panicId)) return res.status(403).send('Invalid or expired map token');
  try {
    const image = await renderSecurityMap(panicId);
    if (!image) return res.status(404).send('Incident location unavailable');
    res.set({ 'Content-Type': 'image/png', 'Content-Length': String(image.length), 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline; filename="sonalit-security-incident.png"', 'X-Content-Type-Options': 'nosniff' });
    return res.send(image);
  } catch (error) {
    logger.error(`Security incident map render failed: event=${panicId} error=${error.message}`);
    return res.status(502).send('Incident map temporarily unavailable');
  }
});

const statusMap = {
  'email.sent': 'sent', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delivery_delayed',
  'email.opened': 'opened', 'email.clicked': 'clicked', 'email.bounced': 'bounced',
  'email.complained': 'complained', 'email.failed': 'failed', 'email.suppressed': 'suppressed',
};

router.post('/', async (req, res) => {
  if (!verifySignature(req)) return res.status(401).json({ error: 'invalid_webhook_signature' });
  const event = req.body || {};
  const eventId = req.headers['svix-id'] || null;
  const type = event.type;
  const providerEmailId = event.data?.email_id || event.data?.id || null;
  const status = statusMap[type];
  if (!type || !providerEmailId || !eventId) return res.status(400).json({ error: 'invalid_webhook_payload' });
  if (!status) return res.status(202).json({ accepted: true, ignored: true });

  try {
    // Resolve the message under the provider-authenticated webhook identity.
    // The event receipt is deliberately persisted only after the tenant-scoped
    // projection commits; otherwise a transient tenant-write failure would
    // poison the idempotency key and turn every retry into a false success.
    const current = await globalQuery(
      `SELECT id, org_id FROM email_notifications WHERE provider_email_id=$1 LIMIT 1`,
      [providerEmailId]
    );
    if (!current.rows.length) {
      await globalQuery(
        `INSERT INTO resend_webhook_events (event_id, provider_email_id, event_type) VALUES ($1,$2,$3)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [eventId, providerEmailId, type]
      );
      logger.warn(`Resend webhook received before local email record: provider=${providerEmailId} type=${type}`);
      return res.status(200).json({ received: true, unmatched: true });
    }

    const row = current.rows[0];
    const outcome = await withOrg(row.org_id, async (client) => {
      // Svix delivery is at-least-once and retries can arrive concurrently.
      // Serialize a provider event across workers and tenant transactions, then
      // use the append-only delivery row as the authoritative completion marker.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [eventId]);
      const applied = await client.query(
        `SELECT id FROM communication_delivery_events
         WHERE org_id=$1 AND provider_event_id=$2 LIMIT 1`,
        [row.org_id, eventId]
      );
      if (applied.rows.length) return { duplicate: true, advanced: false };

      // Re-read and lock the current notification after acquiring the event
      // lock. This prevents out-of-order webhook requests from regressing a
      // newer state and lets retries repair receipt rows created by older code.
      const latest = await client.query(
        `SELECT id, status, correlation_id FROM email_notifications WHERE id=$1 FOR UPDATE`,
        [row.id]
      );
      if (!latest.rows.length) return { unmatched: true, duplicate: false, advanced: false };

      const notification = latest.rows[0];
      const currentRank = STATUS_RANK[notification.status] ?? 0;
      const nextRank = STATUS_RANK[status] ?? 0;
      const shouldAdvance = TERMINAL.has(status)
        ? !TERMINAL.has(notification.status)
        : !TERMINAL.has(notification.status) && nextRank > currentRank;

      if (shouldAdvance) {
        await client.query(
          `UPDATE email_notifications SET status=$1, provider_event_id=COALESCE(provider_event_id,$2),
            delivered_at=CASE WHEN $1='delivered' THEN COALESCE(delivered_at,NOW()) ELSE delivered_at END,
            failed_at=CASE WHEN $1 IN ('failed','bounced','suppressed','complained') THEN COALESCE(failed_at,NOW()) ELSE failed_at END,
            updated_at=NOW() WHERE id=$3`,
          [status, eventId, notification.id]
        );
      }

      // Write the projection and audit event in the same tenant transaction so
      // a rollback leaves no partial success. The advisory lock + this lookup
      // provides event-level idempotency without deleting existing audit data.
      await client.query(
        `INSERT INTO communication_delivery_events
          (org_id,event_type,channel,status,provider_message_id,provider_event_id,correlation_id,metadata,sent_at,delivered_at,failed_at)
         VALUES ($1,$2,'email',$3,$4,$5,$6,$7::jsonb,
           CASE WHEN $3 IN ('sent','delivered','opened','clicked') THEN NOW() ELSE NULL END,
           CASE WHEN $3 IN ('delivered','opened','clicked') THEN NOW() ELSE NULL END,
           CASE WHEN $3 IN ('failed','bounced','suppressed','complained') THEN NOW() ELSE NULL END)`,
        [row.org_id, type, status, providerEmailId, eventId, notification.correlation_id || null, JSON.stringify({ provider: 'resend', raw_type: type })]
      );
      return { duplicate: false, advanced: shouldAdvance };
    });

    if (outcome.unmatched) {
      await globalQuery(
        `INSERT INTO resend_webhook_events (event_id, provider_email_id, event_type) VALUES ($1,$2,$3)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [eventId, providerEmailId, type]
      );
      logger.warn(`Resend webhook lost local email row during processing: provider=${providerEmailId} type=${type}`);
      return res.status(200).json({ received: true, unmatched: true });
    }

    // This receipt insert may conflict for a retry from the legacy failure
    // path. Do not short-circuit on that conflict: the tenant projection above
    // was still checked and repaired if the receipt existed without an audit.
    const receipt = await globalQuery(
      `INSERT INTO resend_webhook_events (event_id, provider_email_id, event_type) VALUES ($1,$2,$3)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId, providerEmailId, type]
    );

    logger.info(`Resend webhook processed: type=${type} provider=${providerEmailId} advanced=${outcome.advanced} duplicate=${outcome.duplicate}`);
    return res.status(200).json({
      received: true,
      duplicate: outcome.duplicate || !receipt.rows.length,
      advanced: outcome.advanced,
    });
  } catch (err) {
    logger.error(`Resend webhook processing failed: ${err.message}`);
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }
});

module.exports = router;
