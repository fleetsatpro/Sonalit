/**
 * Central authorization decision point.
 *
 * The chain a protected route runs through:
 *
 *   authenticate()            → who is this (existing middleware/auth.js)
 *   attachSecurityContext()   → what are they authorized to be, server-derived
 *   requireScope()            → platform or tenant domain
 *   requirePermission()       → may they do this kind of thing
 *   requireModule()           → has the tenant bought this capability
 *   requireTenantOwnership()  → does *this* resource belong to their tenant
 *
 * Permission alone is never enough. `vehicles.read` says the identity may read
 * vehicles; requireTenantOwnership is what stops it reading vehicle
 * `<someone else's uuid>`. That pairing is what closes BOLA/IDOR.
 *
 * Failures answer with a single shape — 403 `forbidden` — regardless of whether
 * the resource is missing, belongs to another tenant, or exists but is barred.
 * The specific reason goes to the security log, never to the caller, so the
 * error cannot be used to probe for what exists.
 */
const { resolveSecurityContext, SCOPE_PLATFORM, SCOPE_TENANT } = require('./context');
const { hasPermission } = require('./permissions');
const { ACTIONS, recordDenial } = require('./events');
const { withOrg } = require('../utils/orgScopedDb');
const logger = require('../utils/logger');

/** The one response shape every authorization failure uses. */
function deny(res) {
  return res.status(403).json({ error: 'forbidden' });
}

/**
 * Resolve the security context and hang it off the request.
 *
 * Runs after authenticate(). The requested tenant is read from a header rather
 * than the body so it survives GETs, and it is only ever a hint: resolution
 * authorizes it against memberships and support sessions before it becomes the
 * context tenant.
 */
function attachSecurityContext(options = {}) {
  const { required = true } = options;

  return async function attachSecurityContextMiddleware(req, res, next) {
    if (!req.user) {
      if (!required) return next();
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const requestedTenantId = normalizeUuid(req.get('x-sonalit-tenant'));

      const context = await resolveSecurityContext(req.user, { requestedTenantId });

      if (!context) {
        await recordDenial(ACTIONS.UNAUTHORIZED_ACCESS, {
          req,
          reason: requestedTenantId ? 'no_authorized_membership_for_requested_tenant' : 'no_authorized_membership',
          tenantId: requestedTenantId,
        });
        if (!required) return next();
        return deny(res);
      }

      req.security = context;

      // Keep req.db pointed at the resolved tenant. For a platform operator in
      // support mode this deliberately scopes the connection to the tenant being
      // supported, so RLS keeps protecting that tenant's data while Sonalit is
      // inside it — support mode is not an unrestricted database session.
      if (context.tenantId) {
        req.db = (text, params) => withOrg(context.tenantId, (client) => client.query(text, params));
        req.dbTx = (fn) => withOrg(context.tenantId, fn);
      }

      return next();
    } catch (err) {
      logger.error(`attachSecurityContext failed: ${err.message}`);
      return next(err);
    }
  };
}

/** Accept a UUID-shaped hint and nothing else, so the header cannot carry SQL or junk. */
function normalizeUuid(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(trimmed)
    ? trimmed
    : null;
}

/**
 * Require the request to be operating in a given domain.
 * requireScope('PLATFORM') is the guard on every Mission Control route.
 */
function requireScope(scope) {
  return async function requireScopeMiddleware(req, res, next) {
    const context = req.security;
    if (!context) return deny(res);

    if (context.scope !== scope) {
      await recordDenial(ACTIONS.AUTHORIZATION_FAILURE, {
        context, req, reason: `scope_required:${scope}`,
      });
      return deny(res);
    }
    return next();
  };
}

/**
 * A tenant-scoped request is only served while its tenant is ACTIVE.
 *
 * Suspension has to bite here, in authorization, rather than by hiding the
 * dashboard — otherwise a suspended customer keeps full API access and only
 * loses the UI. Platform scope is exempt so Sonalit can still administer and
 * investigate a suspended tenant.
 */
function requireActiveTenant() {
  return async function requireActiveTenantMiddleware(req, res, next) {
    const context = req.security;
    if (!context) return deny(res);
    if (context.scope === SCOPE_PLATFORM) return next();

    if (context.tenantStatus !== 'ACTIVE') {
      await recordDenial(ACTIONS.AUTHORIZATION_FAILURE, {
        context, req, reason: `tenant_status:${context.tenantStatus}`,
      });
      return res.status(403).json({ error: 'tenant_inactive' });
    }
    return next();
  };
}

/**
 * Require a permission. Module entitlement is already folded into the resolved
 * permission list, so a permission belonging to a disabled module simply is not
 * present and this denies.
 */
function requirePermission(...required) {
  const needed = required.flat();
  return async function requirePermissionMiddleware(req, res, next) {
    const context = req.security;
    if (!context) return deny(res);

    const ok = needed.every((permission) => hasPermission(context.permissions, permission));
    if (!ok) {
      await recordDenial(ACTIONS.AUTHORIZATION_FAILURE, {
        context, req, reason: `permission_required:${needed.join(',')}`,
      });
      return deny(res);
    }

    // A read-only context (support mode, PLATFORM_READONLY) may not mutate,
    // whatever its permissions say.
    if (context.readOnly && !isReadRequest(req)) {
      await recordDenial(ACTIONS.AUTHORIZATION_FAILURE, {
        context, req, reason: 'read_only_context',
      });
      return res.status(403).json({ error: 'read_only_context' });
    }

    return next();
  };
}

function isReadRequest(req) {
  return req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
}

/** Require a module entitlement directly, for routes with no single permission. */
function requireModule(moduleName) {
  return async function requireModuleMiddleware(req, res, next) {
    const context = req.security;
    if (!context) return deny(res);
    if (context.scope === SCOPE_PLATFORM) return next();

    if (!(context.enabledModules || []).includes(moduleName)) {
      await recordDenial(ACTIONS.AUTHORIZATION_FAILURE, {
        context, req, reason: `module_not_enabled:${moduleName}`,
      });
      return res.status(403).json({ error: 'module_not_enabled' });
    }
    return next();
  };
}

/**
 * Resource-level authorization.
 *
 * Confirms the addressed row actually belongs to the caller's tenant before the
 * handler runs. The lookup goes through req.db, so RLS is doing the filtering
 * and a foreign id comes back as "no row" rather than as someone else's record —
 * the check and the database policy agree by construction.
 *
 * @param {string} table       table to check ownership in
 * @param {string} [param]     route param holding the id (default 'id')
 * @param {string} [column]    id column (default 'id')
 */
function requireTenantOwnership(table, param = 'id', column = 'id') {
  if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[a-z_][a-z0-9_]*$/.test(column)) {
    throw new Error(`requireTenantOwnership: unsafe identifier ${table}.${column}`);
  }

  return async function requireTenantOwnershipMiddleware(req, res, next) {
    const context = req.security;
    if (!context) return deny(res);

    const resourceId = req.params[param];
    if (!resourceId) return deny(res);

    // Platform-wide scope with no tenant selected has no ownership to check
    // against; those routes are guarded by requireScope('PLATFORM') instead.
    if (context.scope === SCOPE_PLATFORM && !context.tenantId) return next();

    try {
      const result = await req.db(
        `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`,
        [resourceId]
      );

      if (result.rowCount === 0) {
        await recordDenial(ACTIONS.CROSS_TENANT_ATTEMPT, {
          context, req,
          reason: 'resource_not_owned_or_absent',
          resourceType: table,
          resourceId,
        });
        // Same 403 whether the row is missing or foreign — the caller learns
        // nothing about which.
        return deny(res);
      }

      return next();
    } catch (err) {
      logger.error(`requireTenantOwnership(${table}) failed: ${err.message}`);
      return next(err);
    }
  };
}

module.exports = {
  attachSecurityContext,
  requireScope,
  requireActiveTenant,
  requirePermission,
  requireModule,
  requireTenantOwnership,
  SCOPE_PLATFORM,
  SCOPE_TENANT,
};
