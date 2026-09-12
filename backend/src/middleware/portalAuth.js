/**
 * portalAuth — verifies a cargo-owner portal Bearer token.
 * Attaches req.portal = { convoy_id, org_id, cargo_owner_ref } on success.
 * Also attaches req.db via withOrg so portal routes can query with RLS.
 */
const crypto = require('crypto');
const { query } = require('../config/database');
const { withOrg } = require('../utils/orgScopedDb');
const logger = require('../utils/logger');

async function portalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const rawToken = authHeader.slice(7);
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const result = await query(
      `SELECT id, org_id, convoy_id, cargo_owner_ref, expires_at, revoked_at
         FROM portal_tokens
        WHERE token_hash = $1`,
      [tokenHash],
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid portal token' });
    }

    const row = result.rows[0];

    if (row.revoked_at) {
      return res.status(401).json({ error: 'Portal token has been revoked' });
    }

    if (new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Portal token has expired' });
    }

    // Update last_used_at (best-effort, no-throw)
    query(
      `UPDATE portal_tokens SET last_used_at = NOW() WHERE id = $1`,
      [row.id],
    ).catch(err => logger.warn(`portal last_used_at update failed: ${err.message}`));

    req.portal = {
      token_id: row.id,
      org_id: row.org_id,
      convoy_id: row.convoy_id,
      cargo_owner_ref: row.cargo_owner_ref,
    };

    req.db = (text, params) => withOrg(row.org_id, client => client.query(text, params));
    req.dbTx = (fn) => withOrg(row.org_id, fn);

    next();
  } catch (err) {
    logger.error(`portalAuth middleware error: ${err.message}`);
    next(err);
  }
}

module.exports = { portalAuth };
