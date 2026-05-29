/**
 * WhatsApp Cloud API helper (Meta Business API)
 * RULE C: org config loaded via withOrg
 */
const { withOrg } = require('./orgScopedDb');
const logger = require('./logger');

async function getWhatsAppConfig(orgId) {
  let config = null;
  await withOrg(orgId, async (db) => {
    const r = await db.query(
      `SELECT phone_number_id, access_token, active FROM whatsapp_config WHERE org_id = $1`,
      [orgId],
    );
    if (r.rows.length && r.rows[0].active) config = r.rows[0];
  });
  return config;
}

/**
 * sendWhatsAppMessage(orgId, toNumber, message)
 * toNumber: E.164 format (e.g. +254712345678)
 * Returns true if sent successfully.
 */
async function sendWhatsAppMessage(orgId, toNumber, message) {
  const config = await getWhatsAppConfig(orgId);
  if (!config) {
    logger.warn(`WhatsApp not configured for org ${orgId}`);
    return false;
  }

  const url = `https://graph.facebook.com/v20.0/${config.phone_number_id}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: toNumber.replace(/\s+/g, ''),
    type: 'text',
    text: { preview_url: false, body: message },
  };

  try {
    const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }));
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      logger.warn(`WhatsApp send failed (${res.status}): ${err}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.error(`WhatsApp send error: ${err.message}`);
    return false;
  }
}

/**
 * verifyWebhookSignature(rawBody, signature, appSecret)
 * Verifies X-Hub-Signature-256 from Meta webhook calls.
 */
function verifyWebhookSignature(rawBody, signature, appSecret) {
  const crypto = require('crypto');
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch (_) { return false; }
}

module.exports = { sendWhatsAppMessage, verifyWebhookSignature, getWhatsAppConfig };
