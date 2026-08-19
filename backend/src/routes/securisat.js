/**
 * Securisat / Viasat Connect telemetry webhook.
 * Mounted at /api/v1/securisat, BEFORE the CSRF middleware in app.js.
 *
 * Some telemetry is better pushed than polled — a tamper alarm should not wait
 * for the next poll cycle. When Securisat is configured to push events, they
 * land here: HMAC-verified (no JWT, no CSRF — RULE D, same as the fuel and
 * WhatsApp webhooks), mapped through the Viasat adapter, and run through the
 * same provider-agnostic ingest core the poller uses.
 *
 * Org is resolved from the DEVICE, never from a field in the payload: a signed
 * sender still shouldn't be able to name which tenant a sample lands in. We
 * look the lock up by its provider device id / serial across orgs, and drop
 * (200-ack) anything for a device CDS doesn't know — so an unrecognised ping
 * can't create data or probe which devices exist.
 */
const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../config/database');
const { withOrg } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { ingestBatch } = require('../utils/telemetry/ingest');
const viasat = require('../utils/telemetry/viasatAdapter');
const logger = require('../utils/logger');

function verifySignature(rawBody, sig, secret) {
  if (!rawBody || !sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Accept the signature with or without the "sha256=" prefix.
  const candidates = [sig, sig.startsWith('sha256=') ? sig.slice(7) : `sha256=${sig}`];
  return candidates.some((c) => {
    try {
      return c.length === expected.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(expected));
    } catch { return false; }
  });
}

/** Find the org that owns a device, without trusting the payload. */
async function resolveOrgForSample(sample) {
  if (sample.external_device_id) {
    const r = await query(
      `SELECT org_id FROM cds_electronic_locks
        WHERE external_device_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [sample.external_device_id]
    );
    if (r.rows.length) return r.rows[0].org_id;
  }
  if (sample.serial) {
    const r = await query(
      `SELECT org_id FROM cds_electronic_locks
        WHERE serial = $1 AND deleted_at IS NULL LIMIT 1`,
      [String(sample.serial).trim()]
    );
    if (r.rows.length) return r.rows[0].org_id;
  }
  return null;
}

router.post('/webhook', asyncHandler(async (req, res) => {
  const secret = process.env.SECURISAT_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Securisat webhook not configured' });

  const sig = req.headers['x-securisat-signature'] || req.headers['x-hub-signature-256'] || req.headers['x-signature'] || '';
  if (!req.rawBody) return res.status(400).json({ error: 'Raw body unavailable' });
  if (!verifySignature(req.rawBody, sig, secret)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Accept a single event or a batch.
  const body = req.body;
  const events = Array.isArray(body) ? body : (Array.isArray(body.events) ? body.events : [body]);
  const samples = events.map((e) => viasat.mapAlarm(e)).filter((s) => s.external_device_id || s.serial);

  // Group by resolved org so each tenant's writes go through one withOrg scope.
  const byOrg = new Map();
  let unknown = 0;
  for (const s of samples) {
    const orgId = await resolveOrgForSample(s);
    if (!orgId) { unknown++; continue; }
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId).push(s);
  }

  let ingested = 0;
  for (const [orgId, group] of byOrg) {
    try {
      const results = await withOrg(orgId, (db) => ingestBatch(db, orgId, group));
      ingested += results.filter((r) => r && r.lock_id && !r.skipped).length;
    } catch (err) {
      logger.warn(`securisat webhook ingest failed for org ${orgId}: ${err.message}`);
    }
  }

  // Always 200 on a valid signature — a provider that gets a 4xx/5xx will retry
  // and back off, and an unknown device is not a failure on our side.
  res.json({ received: samples.length, ingested, unknown });
}));

module.exports = router;
