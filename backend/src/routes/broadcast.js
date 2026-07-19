/**
 * S2-F4: Convoy Broadcast + WhatsApp
 *
 * RULE D:
 *   - POST /convoys/:id/broadcast: requires X-Idempotency-Key
 *   - POST /guardian/whatsapp/webhook: no JWT/CSRF, X-Hub-Signature-256 verified
 *   - GET  /guardian/whatsapp/webhook: verify_token challenge (no auth)
 */
const router = require('express').Router();
const Joi = require('joi');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { withOrg } = require('../utils/orgScopedDb');
const { query } = require('../config/database');
const { publish } = require('../realtime/centrifugo');
const { sendWhatsAppMessage, verifyWebhookSignature } = require('../utils/whatsapp');
const { asyncHandler } = require('../middleware/error');
const { auditLog } = require('../middleware/audit');
const logger = require('../utils/logger');

// ─── WhatsApp webhook (no auth, no CSRF) ─────────────────────────────────────

// GET /guardian/whatsapp/webhook — Meta verification challenge
router.get('/guardian/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && token === expected) {
    return res.status(200).send(challenge);
  }
  res.status(403).json({ error: 'Verification failed' });
});

// POST /guardian/whatsapp/webhook — incoming messages (HMAC-verified)
router.post('/guardian/whatsapp/webhook', asyncHandler(async (req, res) => {
  const sig = req.headers['x-hub-signature-256'] || '';
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return res.status(503).json({ error: 'Webhook not configured' });

  if (!req.rawBody || !verifyWebhookSignature(req.rawBody, sig, appSecret)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Persist inbound messages (previously only logged, then dropped) and push
  // them live to the owning org's dashboard.
  const body = req.body;
  if (body?.entry) {
    for (const entry of body.entry) {
      for (const change of (entry.changes ?? [])) {
        const value = change.value ?? {};
        const messages = value.messages ?? [];
        if (!messages.length) continue;

        const phoneNumberId = value.metadata?.phone_number_id ?? null;
        // Resolve which org owns the receiving business number. The raw pooled
        // connection runs as the superuser role, which bypasses whatsapp_config's
        // RLS, so this cross-org lookup works without an org context. org stays
        // null (message still stored) if nothing matches.
        let orgId = null;
        if (phoneNumberId) {
          try {
            const r = await query(
              `SELECT org_id FROM whatsapp_config WHERE phone_number_id = $1 ORDER BY active DESC LIMIT 1`,
              [phoneNumberId],
            );
            orgId = r.rows[0]?.org_id ?? null;
          } catch (err) {
            logger.warn(`WhatsApp org resolution failed: ${err.message}`);
          }
        }

        for (const msg of messages) {
          const bodyText = msg.text?.body ?? msg.button?.text ?? null;
          try {
            const ins = await query(
              `INSERT INTO whatsapp_inbound_messages
                 (org_id, wa_message_id, phone_number_id, from_number, msg_type, body, raw)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (wa_message_id) DO NOTHING
               RETURNING id, received_at`,
              [orgId, msg.id ?? null, phoneNumberId, msg.from ?? null, msg.type ?? null, bodyText, JSON.stringify(msg)],
            );
            if (ins.rows.length && orgId) {
              publish(`org#${orgId}`, {
                type: 'whatsapp_inbound',
                id: ins.rows[0].id,
                from: msg.from ?? null,
                msg_type: msg.type ?? null,
                body: bodyText,
                received_at: ins.rows[0].received_at,
              });
            }
          } catch (err) {
            logger.error(`WhatsApp inbound persist failed: ${err.message}`);
          }
        }
      }
    }
  }
  res.json({ ok: true });
}));

// ─── Authenticated routes ─────────────────────────────────────────────────────
router.use(authenticate, attachOrgDb);

const broadcastSchema = Joi.object({
  message: Joi.string().min(1).max(4000).required(),
  channel: Joi.string().valid('app', 'whatsapp', 'sms', 'email').default('app'),
  canned_message_id: Joi.string().uuid(),
});

// POST /convoys/:id/broadcast — send broadcast to all convoy drivers
router.post('/convoys/:id/broadcast', auditLog('convoy_broadcasts'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey) return res.status(400).json({ error: 'X-Idempotency-Key header required' });

  const { error, value } = broadcastSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  // Load canned message if provided
  let message = value.message;
  if (value.canned_message_id) {
    const cannedRes = await req.db(
      `SELECT body FROM canned_messages WHERE id = $1 AND active = true`,
      [value.canned_message_id],
    );
    if (cannedRes.rows.length) message = cannedRes.rows[0].body;
  }

  // Get convoy drivers' phone numbers
  const driversRes = await req.db(
    `SELECT DISTINCT u.id, u.name, u.phone
       FROM convoy_trucks ct
       JOIN vehicles v ON v.id = ct.vehicle_id
       JOIN users u ON u.id = v.assigned_driver_id
      WHERE ct.convoy_id = $1 AND u.phone IS NOT NULL`,
    [req.params.id],
  );

  const drivers = driversRes.rows;

  // Record broadcast intent
  const broadcastRes = await req.db(
    `INSERT INTO convoy_broadcasts (org_id, convoy_id, sender_id, channel, message, recipient_count, status, idempotency_key)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1, $2, $3, $4, $5, 'pending', $6)
     ON CONFLICT (idempotency_key) DO UPDATE SET status = convoy_broadcasts.status
     RETURNING *`,
    [req.params.id, req.user.id, value.channel, message, drivers.length, idempotencyKey],
  );
  const broadcast = broadcastRes.rows[0];

  // Send via WhatsApp asynchronously if channel === whatsapp
  if (value.channel === 'whatsapp' && drivers.length > 0) {
    const orgId = req.user.org_id;
    let sent = 0;
    for (const d of drivers) {
      const ok = await sendWhatsAppMessage(orgId, d.phone, message).catch(() => false);
      if (ok) sent++;
    }
    await req.db(
      `UPDATE convoy_broadcasts SET status = $1, sent_at = NOW() WHERE id = $2`,
      [sent === drivers.length ? 'sent' : sent > 0 ? 'partial' : 'failed', broadcast.id],
    );
    broadcast.status = sent === drivers.length ? 'sent' : sent > 0 ? 'partial' : 'failed';
  } else if (drivers.length > 0) {
    await req.db(
      `UPDATE convoy_broadcasts SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [broadcast.id],
    );
    broadcast.status = 'sent';
  }

  req.auditAction = 'CREATE';
  req.auditRecordId = broadcast.id;
  req.auditAfter = broadcast;
  res.status(201).json({ data: broadcast, recipients: drivers.length });
}));

// GET /convoys/:id/broadcasts — list broadcasts for convoy
router.get('/convoys/:id/broadcasts', asyncHandler(async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const result = await req.db(
    `SELECT b.*, u.name AS sender_name
       FROM convoy_broadcasts b
       LEFT JOIN users u ON u.id = b.sender_id
      WHERE b.convoy_id = $1
      ORDER BY b.created_at DESC
      LIMIT $2`,
    [req.params.id, limit],
  );
  res.json({ data: result.rows });
}));

// ─── Canned messages ──────────────────────────────────────────────────────────

router.get('/canned-messages', asyncHandler(async (req, res) => {
  const result = await req.db(`SELECT * FROM canned_messages WHERE active = true ORDER BY category, title`);
  res.json({ data: result.rows });
}));

router.post('/canned-messages', auditLog('canned_messages'), asyncHandler(async (req, res) => {
  const schema = Joi.object({
    title: Joi.string().max(200).required(),
    body: Joi.string().min(1).max(4000).required(),
    category: Joi.string().max(50).default('general'),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `INSERT INTO canned_messages (org_id, title, body, category)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1, $2, $3) RETURNING *`,
    [value.title, value.body, value.category],
  );
  req.auditAction = 'CREATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.status(201).json({ data: result.rows[0] });
}));

router.put('/canned-messages/:id', auditLog('canned_messages'), asyncHandler(async (req, res) => {
  const schema = Joi.object({ title: Joi.string().max(200), body: Joi.string().max(4000), category: Joi.string().max(50), active: Joi.boolean() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `UPDATE canned_messages SET title=COALESCE($1,title), body=COALESCE($2,body),
      category=COALESCE($3,category), active=COALESCE($4,active), updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [value.title || null, value.body || null, value.category || null, value.active ?? null, req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  req.auditAction = 'UPDATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.json({ data: result.rows[0] });
}));

router.delete('/canned-messages/:id', auditLog('canned_messages'), asyncHandler(async (req, res) => {
  await req.db(`UPDATE canned_messages SET active = false, updated_at = NOW() WHERE id = $1`, [req.params.id]);
  req.auditAction = 'DELETE';
  req.auditRecordId = req.params.id;
  res.json({ ok: true });
}));

// ─── WhatsApp inbound ─────────────────────────────────────────────────────────

// GET /whatsapp/inbound — inbound messages for the caller's org (RLS-scoped via
// req.db). Persisted by the webhook above; NULL-org messages stay hidden here.
router.get('/whatsapp/inbound', asyncHandler(async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const result = await req.db(
    `SELECT id, from_number, msg_type, body, received_at
       FROM whatsapp_inbound_messages
      ORDER BY received_at DESC LIMIT $1`,
    [limit],
  );
  res.json({ data: result.rows });
}));

// ─── WhatsApp settings ────────────────────────────────────────────────────────

router.get('/settings/whatsapp', asyncHandler(async (req, res) => {
  const result = await req.db(`SELECT phone_number_id, business_id, active FROM whatsapp_config WHERE org_id = (current_setting('app.current_org_id',true))::uuid`);
  res.json({ data: result.rows[0] ?? null });
}));

router.put('/settings/whatsapp', auditLog('whatsapp_config'), asyncHandler(async (req, res) => {
  const schema = Joi.object({
    phone_number_id: Joi.string().max(100),
    access_token: Joi.string().max(2000),
    verify_token: Joi.string().max(200),
    business_id: Joi.string().max(100),
    active: Joi.boolean(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  await req.db(
    `INSERT INTO whatsapp_config (org_id, phone_number_id, access_token, verify_token, business_id, active, updated_at)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1, $2, $3, $4, $5, NOW())
     ON CONFLICT (org_id) DO UPDATE
       SET phone_number_id = COALESCE(EXCLUDED.phone_number_id, whatsapp_config.phone_number_id),
           access_token    = COALESCE(EXCLUDED.access_token, whatsapp_config.access_token),
           verify_token    = COALESCE(EXCLUDED.verify_token, whatsapp_config.verify_token),
           business_id     = COALESCE(EXCLUDED.business_id, whatsapp_config.business_id),
           active          = COALESCE(EXCLUDED.active, whatsapp_config.active),
           updated_at      = NOW()`,
    [value.phone_number_id || null, value.access_token || null, value.verify_token || null,
     value.business_id || null, value.active ?? null],
  );
  req.auditAction = 'UPDATE';
  res.json({ ok: true });
}));

module.exports = router;
