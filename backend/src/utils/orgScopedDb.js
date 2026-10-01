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
const { normalizeOrgId, runWithOrgContext } = require('./tenantContext');

async function withOrg(orgId, fn) {
  const normalized = String(orgId ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error('invalid_org_id');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Switch to non-superuser role so RLS org_isolation policies are enforced
    // even when the session connects as a PostgreSQL superuser.
    await client.query('SET LOCAL ROLE sonalit_app');
    // SET LOCAL applies only within this transaction — safe with connection pooling
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', normalized]);
    const result = await runWithOrgContext(normalized, () => fn(client));
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
  const orgId = normalizeOrgId(req.user && req.user.org_id);
  if (!orgId) {
    logger.warn(`Tenant scope missing for authenticated request: ${req.method} ${req.originalUrl || req.url}`);
    return _res.status(403).json({ error: 'tenant_scope_required' });
  }

  // Single-query helper. The ambient context additionally protects legacy
  // helpers that still call config/database.query() after authentication.
  req.db = (text, params) => withOrg(orgId, client => client.query(text, params));

  // Multi-query transaction helper
  req.dbTx = (fn) => withOrg(orgId, fn);

  return runWithOrgContext(orgId, next);
}

module.exports = { withOrg, attachOrgDb };
