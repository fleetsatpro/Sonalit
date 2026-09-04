/**
 * Security event log.
 *
 * Separate from middleware/audit.js by design. That module is the hash-chained
 * record of *data mutations*; this one is the security stream — authentication,
 * authorization denials, tenant lifecycle, support mode, exports. Splitting them
 * means the security-critical events can be retained on their own schedule
 * instead of being aged out alongside high-volume operational telemetry.
 *
 * Writes are fire-and-forget: a failure to record an event must never turn a
 * successful request into an error, and must never mask the denial that
 * triggered it. Failures are logged locally instead.
 */
const { pool } = require('../config/database');
const logger = require('../utils/logger');

const ACTIONS = Object.freeze({
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  MFA_CHANGED: 'MFA_CHANGED',

  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_REACTIVATED: 'TENANT_REACTIVATED',

  CUSTOMER_REQUEST_CREATED: 'CUSTOMER_REQUEST_CREATED',
  CUSTOMER_REQUEST_APPROVED: 'CUSTOMER_REQUEST_APPROVED',
  CUSTOMER_REQUEST_REJECTED: 'CUSTOMER_REQUEST_REJECTED',

  USER_CREATED: 'USER_CREATED',
  USER_DISABLED: 'USER_DISABLED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',

  DATA_EXPORT: 'DATA_EXPORT',
  REPORT_GENERATED: 'REPORT_GENERATED',

  SUPPORT_MODE_STARTED: 'SUPPORT_MODE_STARTED',
  SUPPORT_MODE_ENDED: 'SUPPORT_MODE_ENDED',

  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  AUTHORIZATION_FAILURE: 'AUTHORIZATION_FAILURE',
  CROSS_TENANT_ATTEMPT: 'CROSS_TENANT_ATTEMPT',
  TENANT_OWNERSHIP_MUTATION_BLOCKED: 'TENANT_OWNERSHIP_MUTATION_BLOCKED',
});

// Keys whose values must never reach the event log, at any nesting depth.
const REDACTED_KEYS = new Set([
  'password', 'password_hash', 'passwordhash', 'token', 'access_token',
  'refresh_token', 'authorization', 'cookie', 'secret', 'api_key', 'apikey',
  'pin', 'pin_hash', 'signature', 'private_key', 'client_secret',
]);

/**
 * Strip credentials out of arbitrary metadata before it is persisted. Depth is
 * bounded so a cyclic or pathological payload cannot stall the writer.
 */
function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      out[key] = '[redacted]';
    } else {
      out[key] = redact(val, depth + 1);
    }
  }
  return out;
}

/**
 * Record a security event.
 *
 * @param {Object}  event
 * @param {string}  event.action        one of ACTIONS
 * @param {string}  event.result        SUCCESS | FAILURE | DENIED
 * @param {Object}  [event.context]     resolved SecurityContext, when there is one
 * @param {Object}  [event.req]         express request, for correlation and source
 * @param {string}  [event.resourceType]
 * @param {string}  [event.resourceId]
 * @param {string}  [event.tenantId]    overrides the context tenant
 * @param {Object}  [event.metadata]
 * @returns {Promise<void>} resolves even when the write fails
 */
async function recordSecurityEvent(event) {
  const {
    action,
    result,
    context = null,
    req = null,
    resourceType = null,
    resourceId = null,
    tenantId = null,
    actorId = null,
    metadata = {},
  } = event;

  const scope = context ? context.scope : (req && req.user ? 'TENANT' : 'ANONYMOUS');
  const effectiveActor = actorId || (context && context.userId) || (req && req.user && req.user.id) || null;
  const effectiveTenant = tenantId || (context && context.tenantId) || null;

  // Trust the proxy chain only as far as the first hop; the socket address is
  // the fallback so the column is never populated from a client-chosen header
  // alone.
  const sourceIp = req
    ? (req.ip || (req.socket && req.socket.remoteAddress) || null)
    : null;

  try {
    await pool.query(
      `INSERT INTO security_events
         (action, result, scope, actor_id, tenant_id, membership_id,
          resource_type, resource_id, request_id, source_ip, user_agent, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        action,
        result,
        scope,
        effectiveActor,
        effectiveTenant,
        (context && context.membershipId) || null,
        resourceType,
        resourceId === null || resourceId === undefined ? null : String(resourceId),
        (req && (req.id || req.requestId)) || null,
        sourceIp && /^[0-9a-fA-F:.]+$/.test(sourceIp) ? sourceIp : null,
        (req && req.get && req.get('user-agent')) || null,
        JSON.stringify(redact(metadata)),
      ]
    );
  } catch (err) {
    logger.error(`security event write failed (${action}/${result}): ${err.message}`);
  }
}

/** Convenience wrapper for the denial path, which is the one that matters most. */
function recordDenial(action, { context, req, reason, resourceType, resourceId, tenantId }) {
  return recordSecurityEvent({
    action,
    result: 'DENIED',
    context,
    req,
    resourceType,
    resourceId,
    tenantId,
    metadata: { reason, path: req && req.originalUrl, method: req && req.method },
  });
}

module.exports = { ACTIONS, recordSecurityEvent, recordDenial, redact };
