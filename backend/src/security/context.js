/**
 * Security context resolution.
 *
 * The context is built server-side from the authenticated user id and nothing
 * else. No part of it is read from the request: not the scope, not the tenant,
 * not the role, not the permission list. A client may say which tenant it wants
 * to look at (platform drill-down, support mode), but that is a navigation hint
 * which is authorized here before it becomes context.
 *
 * Resolution order matters. Platform scope is checked first because a platform
 * operator may hold no membership at all; a tenant membership is then required
 * for everyone else. Support mode narrows a platform operator *down* into a
 * single tenant rather than widening a customer up.
 */
const { query } = require('../config/database');
const { permissionsFor } = require('./permissions');

const SCOPE_PLATFORM = 'PLATFORM';
const SCOPE_TENANT = 'TENANT';

/**
 * @typedef {Object} SecurityContext
 * @property {string}   userId
 * @property {'PLATFORM'|'TENANT'} scope
 * @property {string|null} tenantId       resolved tenant, null for platform-wide work
 * @property {string|null} membershipId
 * @property {string}   role
 * @property {string[]} permissions
 * @property {string[]} enabledModules
 * @property {string|null} tenantStatus
 * @property {Object|null} support        active support session, when one applies
 * @property {boolean}  readOnly          true when the context may not mutate
 */

/**
 * Look up an active platform grant. Reads platform_admins directly — this table
 * has no tenant-side write path, so a compromised tenant admin cannot forge a
 * row here.
 */
async function loadPlatformGrant(userId) {
  const result = await query(
    `SELECT id, role, status
       FROM platform_admins
      WHERE user_id = $1 AND status = 'ACTIVE' AND revoked_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * The membership that authorizes this user inside a tenant, joined to the
 * tenant so status and entitlements arrive in the same round trip.
 */
async function loadMembership(userId, tenantId) {
  const params = [userId];
  let tenantClause = '';
  if (tenantId) {
    params.push(tenantId);
    tenantClause = 'AND m.tenant_id = $2';
  }

  const result = await query(
    `SELECT m.id            AS membership_id,
            m.role          AS role,
            m.status        AS membership_status,
            t.id            AS tenant_id,
            t.status        AS tenant_status,
            t.enabled_modules,
            t.data_classification
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.status = 'ACTIVE'
        AND m.revoked_at IS NULL
        ${tenantClause}
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

/**
 * The live support session for a platform operator, if any. Expiry is evaluated
 * in SQL so a session cannot outlive its window because of clock drift in the
 * application process.
 */
async function loadSupportSession(userId, tenantId) {
  const params = [userId];
  let tenantClause = '';
  if (tenantId) {
    params.push(tenantId);
    tenantClause = 'AND s.tenant_id = $2';
  }

  const result = await query(
    `SELECT s.id, s.tenant_id, s.reason, s.access_level, s.started_at, s.expires_at,
            t.status AS tenant_status, t.enabled_modules, t.name AS tenant_name
       FROM support_sessions s
       JOIN tenants t ON t.id = s.tenant_id
      WHERE s.platform_user_id = $1
        AND s.ended_at IS NULL
        AND s.expires_at > NOW()
        ${tenantClause}
      ORDER BY s.started_at DESC
      LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

/**
 * Fall back to users.org_id when a user predates the membership backfill. The
 * tenant must still exist and be ACTIVE, so this is a compatibility path, not a
 * bypass: an unregistered or quarantined org_id resolves to no context.
 */
async function loadLegacyOrgContext(userId, role) {
  const result = await query(
    `SELECT u.org_id AS tenant_id, t.status AS tenant_status, t.enabled_modules
       FROM users u
       JOIN tenants t ON t.id = u.org_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, membership_id: null, role };
}

/**
 * Build the security context for an authenticated user.
 *
 * @param {Object} user               the authenticated user row
 * @param {Object} [options]
 * @param {string} [options.requestedTenantId]  navigation hint, authorized here
 * @returns {Promise<SecurityContext|null>} null when nothing authorizes access
 */
async function resolveSecurityContext(user, options = {}) {
  const { requestedTenantId = null } = options;
  const userId = user.id;

  const platformGrant = await loadPlatformGrant(userId);

  if (platformGrant) {
    // Support mode narrows the operator into one tenant. When a tenant is being
    // requested, only an active session for *that* tenant will do — otherwise a
    // platform operator could reach a tenant by asking, with no session recorded.
    const support = await loadSupportSession(userId, requestedTenantId);

    if (support) {
      return {
        userId,
        scope: SCOPE_PLATFORM,
        tenantId: support.tenant_id,
        membershipId: null,
        role: platformGrant.role,
        permissions: permissionsFor({ scope: SCOPE_PLATFORM, role: platformGrant.role }),
        enabledModules: support.enabled_modules || [],
        tenantStatus: support.tenant_status,
        support: {
          id: support.id,
          tenantId: support.tenant_id,
          tenantName: support.tenant_name,
          reason: support.reason,
          accessLevel: support.access_level,
          expiresAt: support.expires_at,
        },
        readOnly: support.access_level === 'READ_ONLY',
      };
    }

    if (requestedTenantId) {
      // A platform operator asked for tenant data without an open support
      // session. Deny rather than silently granting platform-wide scope.
      return null;
    }

    return {
      userId,
      scope: SCOPE_PLATFORM,
      tenantId: null,
      membershipId: null,
      role: platformGrant.role,
      permissions: permissionsFor({ scope: SCOPE_PLATFORM, role: platformGrant.role }),
      enabledModules: [],
      tenantStatus: null,
      support: null,
      readOnly: platformGrant.role === 'PLATFORM_READONLY',
    };
  }

  // Tenant identity. A customer may only ever resolve into a tenant it holds a
  // membership in — requestedTenantId is matched against memberships, so asking
  // for another tenant yields no membership and therefore no context.
  const membership =
    (await loadMembership(userId, requestedTenantId)) ||
    (requestedTenantId ? null : await loadLegacyOrgContext(userId, user.role));

  if (!membership) return null;

  const enabledModules = membership.enabled_modules || [];
  return {
    userId,
    scope: SCOPE_TENANT,
    tenantId: membership.tenant_id,
    membershipId: membership.membership_id || null,
    role: membership.role,
    permissions: permissionsFor({
      scope: SCOPE_TENANT,
      role: membership.role,
      enabledModules,
    }),
    enabledModules,
    tenantStatus: membership.tenant_status,
    support: null,
    readOnly: false,
  };
}

module.exports = {
  SCOPE_PLATFORM,
  SCOPE_TENANT,
  resolveSecurityContext,
  loadPlatformGrant,
  loadMembership,
  loadSupportSession,
};
