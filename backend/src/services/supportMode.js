/**
 * Support mode.
 *
 * When Sonalit needs to look inside a customer account, it opens an explicit,
 * reason-bound, time-limited session rather than impersonating a customer user
 * or permanently widening the operator's privileges.
 *
 * The important property: an open session *narrows* the operator into one
 * tenant. resolveSecurityContext gives that session a tenantId, and
 * attachSecurityContext points req.db at it via withOrg — so the tenant's own
 * RLS policies stay in force for the whole session. Support mode is not an
 * unrestricted database view; it is a scoped one, which is what makes an
 * accidental cross-tenant write during an investigation impossible rather than
 * merely unlikely.
 *
 * Sessions default to read-only. Write access is a separate, explicit choice.
 */
const { withPlatform } = require('../utils/orgScopedDb');
const { ACTIONS, recordSecurityEvent } = require('../security/events');

const DEFAULT_DURATION_MINUTES = 60;
const MAX_DURATION_MINUTES = 480; // 8h — an investigation, not standing access
const MIN_REASON_LENGTH = 10;

/**
 * Open a support session.
 *
 * @param {Object} params
 * @param {Object} params.context     the platform operator's security context
 * @param {string} params.tenantId    tenant to support
 * @param {string} params.reason      why — recorded and shown in the UI
 * @param {string} [params.accessLevel] READ_ONLY (default) | READ_WRITE
 * @param {number} [params.durationMinutes]
 * @param {Object} [params.req]       for correlation in the security log
 */
async function startSupportSession({
  context,
  tenantId,
  reason,
  accessLevel = 'READ_ONLY',
  durationMinutes = DEFAULT_DURATION_MINUTES,
  req = null,
}) {
  if (!context || context.scope !== 'PLATFORM') {
    const err = new Error('platform scope required');
    err.status = 403;
    throw err;
  }

  // Only a full platform admin may open a session, and only PLATFORM_ADMIN may
  // request write access.
  if (context.role !== 'PLATFORM_ADMIN' && context.role !== 'PLATFORM_SUPPORT') {
    const err = new Error('platform support role required');
    err.status = 403;
    throw err;
  }
  if (accessLevel === 'READ_WRITE' && context.role !== 'PLATFORM_ADMIN') {
    const err = new Error('write access requires PLATFORM_ADMIN');
    err.status = 403;
    throw err;
  }

  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
    const err = new Error(`reason must be at least ${MIN_REASON_LENGTH} characters`);
    err.status = 400;
    throw err;
  }

  const minutes = Math.min(
    Math.max(parseInt(durationMinutes, 10) || DEFAULT_DURATION_MINUTES, 1),
    MAX_DURATION_MINUTES
  );

  const session = await withPlatform(async (client) => {
    const tenant = await client.query('SELECT id, name, status FROM tenants WHERE id = $1', [tenantId]);
    if (tenant.rowCount === 0) {
      const err = new Error('tenant not found');
      err.status = 404;
      throw err;
    }

    // One live session per operator per tenant: reopening replaces the old one
    // so the audit trail shows a clean sequence rather than overlapping windows.
    await client.query(
      `UPDATE support_sessions
          SET ended_at = NOW(), ended_reason = 'SUPERSEDED'
        WHERE platform_user_id = $1 AND tenant_id = $2 AND ended_at IS NULL`,
      [context.userId, tenantId]
    );

    const inserted = await client.query(
      `INSERT INTO support_sessions
         (platform_user_id, tenant_id, reason, access_level, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)
       RETURNING id, tenant_id, reason, access_level, started_at, expires_at`,
      [context.userId, tenantId, reason.trim(), accessLevel, String(minutes)]
    );

    return { ...inserted.rows[0], tenant_name: tenant.rows[0].name };
  });

  await recordSecurityEvent({
    action: ACTIONS.SUPPORT_MODE_STARTED,
    result: 'SUCCESS',
    context,
    req,
    tenantId,
    resourceType: 'support_session',
    resourceId: session.id,
    metadata: {
      reason: session.reason,
      accessLevel: session.access_level,
      expiresAt: session.expires_at,
    },
  });

  return session;
}

/**
 * Close a support session early. Sessions also expire on their own — expiry is
 * evaluated in SQL when the context is resolved, so an un-ended session stops
 * granting access the moment its window passes, with no sweeper required.
 */
async function endSupportSession({ context, sessionId, req = null }) {
  if (!context || context.scope !== 'PLATFORM') {
    const err = new Error('platform scope required');
    err.status = 403;
    throw err;
  }

  const ended = await withPlatform(async (client) => {
    const result = await client.query(
      `UPDATE support_sessions
          SET ended_at = NOW(), ended_reason = 'CLOSED'
        WHERE id = $1 AND platform_user_id = $2 AND ended_at IS NULL
        RETURNING id, tenant_id, started_at, ended_at`,
      [sessionId, context.userId]
    );
    return result.rows[0] || null;
  });

  if (!ended) return null;

  await recordSecurityEvent({
    action: ACTIONS.SUPPORT_MODE_ENDED,
    result: 'SUCCESS',
    context,
    req,
    tenantId: ended.tenant_id,
    resourceType: 'support_session',
    resourceId: ended.id,
  });

  return ended;
}

/** Sessions currently open for an operator, for the "you are in support mode" banner. */
async function listActiveSessions(userId) {
  return withPlatform(async (client) => {
    const result = await client.query(
      `SELECT s.id, s.tenant_id, t.name AS tenant_name, s.reason,
              s.access_level, s.started_at, s.expires_at
         FROM support_sessions s
         JOIN tenants t ON t.id = s.tenant_id
        WHERE s.platform_user_id = $1 AND s.ended_at IS NULL AND s.expires_at > NOW()
        ORDER BY s.started_at DESC`,
      [userId]
    );
    return result.rows;
  });
}

module.exports = {
  startSupportSession,
  endSupportSession,
  listActiveSessions,
  DEFAULT_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
};
