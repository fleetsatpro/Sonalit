/**
 * Tenant request context.
 *
 * AsyncLocalStorage makes the authenticated tenant an ambient, request-local
 * invariant. It exists specifically so legacy query callers cannot accidentally
 * bypass RLS after auth has established the tenant.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const ORG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeOrgId(value) {
  const orgId = String(value ?? '').trim();
  if (!ORG_ID_RE.test(orgId)) return null;
  return orgId;
}

function getOrgId() {
  return storage.getStore()?.orgId ?? null;
}

function runWithOrgContext(orgId, fn, client = null) {
  const normalized = normalizeOrgId(orgId);
  if (!normalized) throw new Error('invalid_org_id');
  const parent = storage.getStore();
  return storage.run({
    orgId: normalized,
    client: client || parent?.client || null,
  }, fn);
}

function getTenantDbClient() {
  return storage.getStore()?.client ?? null;
}

module.exports = { normalizeOrgId, getOrgId, getTenantDbClient, runWithOrgContext };
