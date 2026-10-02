/**
 * Request-local tenant context.
 *
 * Every authenticated request/device session enters here. AsyncLocalStorage
 * keeps the tenant (and, while inside withOrg, its checked-out DB client)
 * attached only to the current async execution chain.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const ORG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOrgId(value) {
  const orgId = String(value ?? '').trim();
  return ORG_ID_RE.test(orgId) ? orgId : null;
}

function getOrgId() {
  return storage.getStore()?.orgId ?? null;
}

function getTenantDbClient() {
  return storage.getStore()?.dbClient ?? null;
}

function runWithOrgContext(orgId, fn, dbClient = null) {
  const normalized = normalizeOrgId(orgId);
  if (!normalized) throw new Error('invalid_org_id');
  return storage.run({ orgId: normalized, dbClient }, fn);
}

module.exports = { normalizeOrgId, getOrgId, getTenantDbClient, runWithOrgContext };
