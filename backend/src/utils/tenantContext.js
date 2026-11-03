/**
 * Request-local tenant context.
 *
 * Every authenticated request/device session enters here. AsyncLocalStorage
 * keeps the tenant (and, while inside withOrg, its checked-out DB client)
 * attached only to the current async execution chain.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const ORG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeOrgId(value) {
  const orgId = String(value ?? '').trim();
  // PostgreSQL accepts UUIDs that do not carry RFC 4122 version/variant bits.
  // Sonalit already uses the legacy sentinel tenant
  // 00000000-0000-0000-0000-000000000001, so validation must enforce UUID
  // syntax without rejecting valid database identifiers.
  return ORG_ID_RE.test(orgId) ? orgId.toLowerCase() : null;
}

function getOrgId() {
  return storage.getStore()?.orgId ?? null;
}

function getTenantDbClient() {
  const client = storage.getStore()?.dbClient ?? null;
  return client && !client.__sonalitReleased ? client : null;
}

function runWithOrgContext(orgId, fn, dbClient = null) {
  const normalized = normalizeOrgId(orgId);
  if (!normalized) throw new Error('invalid_org_id');
  const current = getOrgId();
  if (current && current !== normalized) throw new Error('tenant_context_switch_forbidden');
  const currentClient = getTenantDbClient();
  if (currentClient && dbClient && currentClient !== dbClient) throw new Error('tenant_db_client_switch_forbidden');
  return storage.run({ orgId: normalized, dbClient: dbClient || currentClient }, fn);
}

module.exports = { normalizeOrgId, getOrgId, getTenantDbClient, runWithOrgContext };