/**
 * orgScopedDb — Row-Level Security helper.
 *
 * withOrg(orgId, fn) runs fn(client) inside a transaction with
 * SET LOCAL app.current_org_id so RLS policies on org-scoped tables
 * automatically filter to the caller's org.
 *
 * req.db(text, params) is the single-query convenience wrapper.
 * req.dbTx(fn) is for multi-query transactions.
 */
const { pool } = require('../config/database');
const logger = require('./logger');

async function withOrg(orgId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL applies only within this transaction — safe with connection pooling
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Attaches req.db and req.dbTx to every authenticated request.
 * Call this after authenticate() in the middleware chain.
 */
function attachOrgDb(req, _res, next) {
  const orgId = req.user && req.user.org_id;
  if (!orgId) { next(); return; }

  // Single-query helper
  req.db = (text, params) => withOrg(orgId, client => client.query(text, params));

  // Multi-query transaction helper
  req.dbTx = (fn) => withOrg(orgId, fn);

  next();
}

module.exports = { withOrg, attachOrgDb };
