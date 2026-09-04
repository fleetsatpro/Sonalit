/**
 * Realtime channel authorization.
 *
 * Sonalit's Centrifugo channels fall into two very different groups today, and
 * only one of them is actually protected:
 *
 *   org#<orgId>                  — contains '#', so Centrifugo treats it as a
 *   org#<orgId>#comms#<id>         user-limited channel and refuses a
 *   portal#<convoyId>              subscription whose connection token 'sub'
 *                                  does not match. routes/realtime.js sets sub
 *                                  to the org id precisely for this. Protected
 *                                  by the broker itself.
 *
 *   org:<orgId>:device:<id>:...  — no '#', so nothing about the name limits
 *   risk:updates:<orgId>           who may subscribe. These are only reachable
 *   session:<sessionId>            at all because the deployment runs
 *   alert:<orgId>, panic:<orgId>   allow_subscribe_for_client=true, which lets
 *   ...                            any connected client subscribe to any such
 *                                  channel without presenting a token — one
 *                                  tenant's device telemetry, alerts and panic
 *                                  events included.
 *
 * The old /subscription-token endpoint authorized exactly one channel shape
 * (org#<orgId>) and 403'd everything else, so turning allow_subscribe_for_client
 * off would have broken every colon channel rather than securing it. This module
 * is the missing piece: a canonical grammar that says, for a resolved security
 * context, which channels that identity may subscribe to — deriving the tenant
 * from the context and verifying resource ownership against the database for
 * channels that name a device, convoy, comms channel or session.
 *
 * With this in place Centrifugo can be switched to allow_subscribe_for_client
 * = false, which makes a subscription token mandatory and this the only way to
 * get one. Channel naming is not the security boundary; this function is.
 */
const { withOrg } = require('../utils/orgScopedDb');
const { ACTIONS, recordDenial } = require('./events');

/**
 * Channel grammar. Each entry matches one channel shape and says how to
 * authorize it. `ownership` runs a tenant-scoped query — RLS means a resource
 * belonging to another tenant simply is not found, so the check and the
 * database policy agree by construction.
 */
const CHANNEL_RULES = [
  {
    name: 'org_broadcast',
    // org#<orgId> — the main per-tenant fan-out.
    pattern: /^org#([0-9a-fA-F-]{36})$/,
    permission: null, // any authenticated member of the tenant
    tenantFrom: (m) => m[1],
  },
  {
    name: 'org_comms_channel',
    // org#<orgId>#comms#<channelId> — one conversation inside a tenant.
    pattern: /^org#([0-9a-fA-F-]{36})#comms#([0-9a-fA-F-]{36})$/,
    tenantFrom: (m) => m[1],
    ownership: {
      // Membership of the conversation, not merely of the tenant: a comms
      // channel is not readable by every colleague.
      sql: `SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2 LIMIT 1`,
      params: (m, context) => [m[2], context.userId],
    },
  },
  {
    name: 'device_telemetry',
    // org:<orgId>:device:<deviceId>:telemetry|commands|remote_control
    pattern: /^org:([0-9a-fA-F-]{36}):device:([0-9a-fA-F-]{36}):(telemetry|commands|remote_control)$/,
    permission: 'gps.read',
    tenantFrom: (m) => m[1],
    ownership: {
      sql: `SELECT 1 FROM guardian_devices WHERE id = $1 LIMIT 1`,
      params: (m) => [m[2]],
    },
  },
  {
    name: 'org_activity',
    pattern: /^org:([0-9a-fA-F-]{36}):(activity|officers)$/,
    tenantFrom: (m) => m[1],
  },
  {
    name: 'knox_session',
    // org:<orgId>:session:<sessionId> — a live Knox remote session.
    pattern: /^org:([0-9a-fA-F-]{36}):session:([0-9a-fA-F-]{36})$/,
    permission: 'alerts.manage',
    tenantFrom: (m) => m[1],
    ownership: {
      sql: `SELECT 1 FROM knox_remote_sessions WHERE id = $1 LIMIT 1`,
      params: (m) => [m[2]],
    },
  },
  {
    name: 'org_alerts',
    // alert:<orgId> / panic:<orgId> — used by the Guardian CFO surface.
    pattern: /^(alert|panic):([0-9a-fA-F-]{36})$/,
    permission: 'alerts.read',
    tenantFrom: (m) => m[2],
  },
  {
    name: 'risk_updates',
    pattern: /^risk:updates:([0-9a-fA-F-]{36})$/,
    permission: 'alerts.read',
    tenantFrom: (m) => m[1],
  },
  {
    name: 'convoy_report_ready',
    pattern: /^convoy\.report\.ready\.([0-9a-fA-F-]{36})$/,
    permission: 'reports.read',
    tenantFrom: (m) => m[1],
  },
  {
    name: 'convoy_report',
    // convoy:<convoyId>:report — names no tenant, so ownership is the only
    // thing that binds it to one. Resolved through the tenant-scoped pool.
    pattern: /^convoy:([0-9a-fA-F-]{36}):report$/,
    permission: 'reports.read',
    tenantFrom: (_m, context) => context.tenantId,
    ownership: {
      sql: `SELECT 1 FROM convoys WHERE id = $1 LIMIT 1`,
      params: (m) => [m[1]],
    },
  },
];

/**
 * Authorize a subscription request.
 *
 * @param {Object} context  resolved SecurityContext (server-derived)
 * @param {string} channel  requested channel name
 * @param {Object} [req]    express request, for the security log
 * @returns {Promise<{ok: true, rule: string, tenantId: string}|{ok: false, reason: string}>}
 */
async function authorizeChannel(context, channel, req = null) {
  if (!context || typeof channel !== 'string' || channel.length > 200) {
    return { ok: false, reason: 'invalid_request' };
  }

  // A tenant context must be resolved. A platform operator with no tenant
  // selected has no realtime stream of its own to join — it opens a support
  // session, which gives it a tenantId, and is then treated like any other
  // subscriber to that tenant.
  if (!context.tenantId) return { ok: false, reason: 'no_tenant_context' };

  let matched = null;
  let match = null;
  for (const rule of CHANNEL_RULES) {
    const m = rule.pattern.exec(channel);
    if (m) { matched = rule; match = m; break; }
  }

  if (!matched) {
    await denied(context, channel, req, 'unknown_channel');
    return { ok: false, reason: 'unknown_channel' };
  }

  // The tenant named in the channel must be the tenant the server resolved for
  // this identity. This is what stops a client asking for another org's channel
  // by editing the string.
  const channelTenant = matched.tenantFrom(match, context);
  if (!channelTenant || channelTenant.toLowerCase() !== String(context.tenantId).toLowerCase()) {
    await denied(context, channel, req, 'tenant_mismatch');
    return { ok: false, reason: 'tenant_mismatch' };
  }

  if (matched.permission && !(context.permissions || []).includes(matched.permission)) {
    await denied(context, channel, req, `permission_required:${matched.permission}`);
    return { ok: false, reason: 'forbidden' };
  }

  if (matched.ownership) {
    let found = false;
    try {
      const result = await withOrg(context.tenantId, (client) =>
        client.query(matched.ownership.sql, matched.ownership.params(match, context))
      );
      found = result.rowCount > 0;
    } catch (err) {
      // A missing table (a surface not deployed here) must not become an
      // accidental grant.
      await denied(context, channel, req, `ownership_check_failed:${err.code || 'error'}`);
      return { ok: false, reason: 'forbidden' };
    }

    if (!found) {
      await denied(context, channel, req, 'resource_not_owned');
      return { ok: false, reason: 'forbidden' };
    }
  }

  return { ok: true, rule: matched.name, tenantId: context.tenantId };
}

function denied(context, channel, req, reason) {
  return recordDenial(ACTIONS.CROSS_TENANT_ATTEMPT, {
    context,
    req,
    reason,
    resourceType: 'realtime_channel',
    resourceId: channel,
  });
}

/**
 * Build the per-tenant broadcast channel. Publishers should use this rather
 * than interpolating by hand, so a null org can never quietly become a global
 * channel name.
 */
function tenantChannel(orgId) {
  if (!orgId) throw new Error('tenantChannel requires an orgId');
  return `org#${orgId}`;
}

module.exports = { authorizeChannel, tenantChannel, CHANNEL_RULES };
