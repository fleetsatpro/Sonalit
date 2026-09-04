/**
 * Tenant ownership immutability / mass-assignment protection.
 *
 * A customer request must never be able to set or move the fields that decide
 * who owns a row or what an identity is allowed to be. The concrete attack:
 *
 *   PATCH /vehicles/:id  { "org_id": "<another tenant>" }
 *
 * RLS already refuses that write — the policy's USING expression doubles as the
 * WITH CHECK on an UPDATE, so the new row would fail the policy (verified
 * against a live database, not assumed). This middleware is the layer above it:
 * it strips the field before the query is ever built, so the attempt is
 * recorded and rejected in the application rather than surfacing as an opaque
 * database error, and so a future query that happens to run outside RLS is
 * still protected.
 *
 * Two behaviours, deliberately different:
 *   - Ownership/identity fields are *rejected*: a request that tries to move a
 *     row between tenants is refused outright and logged, because there is no
 *     benign reading of it.
 *   - Nothing is silently rewritten. Silent stripping would let a caller
 *     believe a privileged change succeeded.
 */
const { ACTIONS, recordSecurityEvent } = require('./events');

/**
 * Fields a tenant-scoped request may never write. `org_id`/`tenant_id` decide
 * ownership; `role`, `scope` and `permissions` decide authority; the audit and
 * identity columns are the record of what happened.
 */
const PROTECTED_FIELDS = Object.freeze([
  'org_id', 'orgId',
  'tenant_id', 'tenantId',
  'scope',
  'permissions',
  'membership_id', 'membershipId',
  'is_platform_admin', 'isPlatformAdmin',
  'platform_role', 'platformRole',
  'data_classification', 'dataClassification',
]);

/**
 * Fields only a tenant admin (or platform scope) may write. Role changes are
 * legitimate tenant administration, so they are not blanket-forbidden — they
 * are gated on the users.manage permission.
 */
const ROLE_FIELDS = Object.freeze(['role', 'roles']);

/**
 * Reject a request that tries to write ownership or authority fields.
 *
 * Applied to the mutating routes of tenant-owned resources. Platform scope is
 * exempt: tenant transfer and role administration are legitimate platform
 * operations, performed through explicit, audited endpoints.
 */
function blockOwnershipMutation(options = {}) {
  const { allowRoleFor = 'users.manage' } = options;

  return async function blockOwnershipMutationMiddleware(req, res, next) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return next();

    const context = req.security;

    // Platform operators reach tenant transfer through dedicated endpoints that
    // validate, transact and audit the move; this guard is about the ordinary
    // customer-facing surface.
    if (context && context.scope === 'PLATFORM' && !context.support) return next();

    const attempted = PROTECTED_FIELDS.filter((field) =>
      Object.prototype.hasOwnProperty.call(body, field)
    );

    if (attempted.length > 0) {
      await recordSecurityEvent({
        action: ACTIONS.TENANT_OWNERSHIP_MUTATION_BLOCKED,
        result: 'DENIED',
        context,
        req,
        resourceType: req.baseUrl || req.path,
        resourceId: req.params && req.params.id,
        metadata: { fields: attempted, method: req.method, path: req.originalUrl },
      });
      return res.status(403).json({ error: 'forbidden_field', fields: attempted });
    }

    const roleAttempt = ROLE_FIELDS.filter((field) =>
      Object.prototype.hasOwnProperty.call(body, field)
    );

    if (roleAttempt.length > 0) {
      const permitted = context && Array.isArray(context.permissions)
        && context.permissions.includes(allowRoleFor);

      if (!permitted) {
        await recordSecurityEvent({
          action: ACTIONS.AUTHORIZATION_FAILURE,
          result: 'DENIED',
          context,
          req,
          resourceType: req.baseUrl || req.path,
          resourceId: req.params && req.params.id,
          metadata: { reason: 'role_change_without_permission', fields: roleAttempt },
        });
        return res.status(403).json({ error: 'forbidden_field', fields: roleAttempt });
      }

      // A tenant admin may set roles inside its own tenant, but never mint a
      // platform role — platform authority lives in platform_admins and has no
      // write path from here.
      const requested = body.role;
      if (typeof requested === 'string' && /^platform/i.test(requested)) {
        await recordSecurityEvent({
          action: ACTIONS.AUTHORIZATION_FAILURE,
          result: 'DENIED',
          context,
          req,
          metadata: { reason: 'platform_role_escalation_attempt', requested },
        });
        return res.status(403).json({ error: 'forbidden_field', fields: ['role'] });
      }
    }

    return next();
  };
}

/**
 * Whitelist helper for handlers that build an UPDATE from the body. Returns a
 * new object containing only the named fields, so a handler cannot accidentally
 * pass an attacker-chosen column through to SQL.
 */
function pickAllowed(body, allowedFields) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) out[field] = body[field];
  }
  return out;
}

module.exports = {
  PROTECTED_FIELDS,
  ROLE_FIELDS,
  blockOwnershipMutation,
  pickAllowed,
};
