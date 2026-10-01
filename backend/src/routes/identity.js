const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const logger = require('../utils/logger');

const ROLE_CATALOG = [
  { id: 'admin', label: 'Administrator', posture: 'Full platform administration', permissions: ['platform.manage', 'identity.manage', 'operations.write', 'intelligence.read', 'reports.manage'] },
  { id: 'dispatcher', label: 'Dispatcher', posture: 'Operations coordination', permissions: ['operations.read', 'operations.write', 'convoys.manage', 'alerts.manage', 'reports.read'] },
  { id: 'operator', label: 'Operator', posture: 'Control-room operations', permissions: ['operations.read', 'alerts.manage', 'convoys.read', 'tracking.read', 'reports.read'] },
  { id: 'analyst', label: 'Analyst', posture: 'Intelligence and analytical access', permissions: ['intelligence.read', 'intelligence.analyze', 'reports.read', 'tracking.read'] },
  { id: 'cfo', label: 'CFO', posture: 'Financial and convoy oversight', permissions: ['finance.read', 'convoys.read', 'reports.read', 'operations.read'] },
  { id: 'response_crew', label: 'Response Crew', posture: 'Scoped response workflow', permissions: ['response.read', 'response.write'] },
  { id: 'handover_officer', label: 'Handover Officer', posture: 'Scoped shift/handover workflow', permissions: ['handover.read', 'handover.write'] },
  { id: 'yard_agent', label: 'Yard Agent', posture: 'Field-only yard workflow', permissions: ['field.yard'] },
  { id: 'port_agent', label: 'Port Agent', posture: 'Field-only port workflow', permissions: ['field.port'] },
];

const MANAGEABLE_ROLES = ROLE_CATALOG.map((r) => r.id);

function orgId(req) {
  return req.user && req.user.org_id ? req.user.org_id : null;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip || null;
}

function safeUserAgent(req) {
  return String(req.headers['user-agent'] || '').slice(0, 1000) || null;
}

function normalizeStatus(value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  return ['active', 'inactive', 'suspended'].includes(v) ? v : null;
}

router.use(authenticate, authorize('admin'));

router.get('/identity/overview', async (req, res) => {
  const oid = orgId(req);
  if (!oid) return res.status(403).json({ error: 'identity_org_required' });

  try {
    const [counts, sessions, mfa] = await Promise.all([
      query(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days')::int AS created_30d
       FROM users WHERE org_id = $1 AND deleted_at IS NULL`, [oid]),
      query(`SELECT COUNT(*)::int AS active_sessions
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE u.org_id = $1 AND u.deleted_at IS NULL
         AND rt.used_at IS NULL AND COALESCE(rt.revoked_at, NULL) IS NULL
         AND rt.expires_at > NOW()`, [oid]),
      query(`SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE COALESCE(totp_enabled, false) = TRUE)::int AS totp_enabled
       FROM users WHERE org_id = $1 AND deleted_at IS NULL`, [oid]),
    ]);

    const total = Number(counts.rows[0].total || 0);
    const mfaEnabled = Number(mfa.rows[0].totp_enabled || 0);
    res.json({
      data: {
        users: counts.rows[0],
        sessions: sessions.rows[0],
        mfa: { total, totp_enabled: mfaEnabled, coverage_pct: total ? Math.round((mfaEnabled / total) * 100) : 0 },
        role_catalog_size: ROLE_CATALOG.length,
        controls: {
          password_reset: 'not_configured',
          sso: 'provider_dependent',
          passkeys: 'available_in_auth_service',
          session_revocation: 'enabled',
          tenant_isolation: 'org_scoped',
        },
      },
    });
  } catch (err) {
    logger.error(`GET /auth/identity/overview error: ${err.message}`);
    res.status(500).json({ error: 'identity_overview_failed' });
  }
});

router.get('/identity/roles', (req, res) => {
  res.json({ data: ROLE_CATALOG });
});

router.get('/identity/users', async (req, res) => {
  const oid = orgId(req);
  if (!oid) return res.status(403).json({ error: 'identity_org_required' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const search = String(req.query.search || '').trim();
  const role = MANAGEABLE_ROLES.includes(String(req.query.role || '')) ? String(req.query.role) : null;
  const status = normalizeStatus(req.query.status);

  try {
    const params = [oid];
    const where = ['org_id = $1', 'deleted_at IS NULL'];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`(LOWER(name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`);
    }
    if (role) { params.push(role); where.push(`role = $${params.length}`); }
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    const count = await query(`SELECT COUNT(*)::int AS count FROM users WHERE ${where.join(' AND ')}`, params);
    params.push(limit, offset);
    const rows = await query(`SELECT id, name, email, role, status, COALESCE(totp_enabled, false) AS totp_enabled,
      org_id, created_at, updated_at
      FROM users WHERE ${where.join(' AND ')} ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ data: rows.rows, meta: { total: count.rows[0].count, limit, offset } });
  } catch (err) {
    logger.error(`GET /auth/identity/users error: ${err.message}`);
    res.status(500).json({ error: 'identity_users_failed' });
  }
});

router.patch('/identity/users/:id', auditLog('identity_users'), async (req, res) => {
  const oid = orgId(req);
  if (!oid) return res.status(403).json({ error: 'identity_org_required' });
  const targetId = req.params.id;
  const requestedRole = req.body && req.body.role;
  const requestedStatus = normalizeStatus(req.body && req.body.status);
  const requestedName = typeof (req.body && req.body.name) === 'string' ? req.body.name.trim() : null;

  if (requestedRole && !MANAGEABLE_ROLES.includes(requestedRole)) return res.status(400).json({ error: 'invalid_role' });
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'status') && !requestedStatus) return res.status(400).json({ error: 'invalid_status' });
  if (targetId === req.user.id && requestedStatus && requestedStatus !== 'active') {
    return res.status(400).json({ error: 'cannot_disable_current_account' });
  }
  if (requestedRole === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'admin_role_required' });

  try {
    const before = await query(`SELECT id, name, email, role, status FROM users WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [targetId, oid]);
    if (!before.rows.length) return res.status(404).json({ error: 'user_not_found' });

    const updates = [];
    const params = [];
    if (requestedName) { params.push(requestedName); updates.push(`name = $${params.length}`); }
    if (requestedRole) { params.push(requestedRole); updates.push(`role = $${params.length}`); }
    if (requestedStatus) { params.push(requestedStatus); updates.push(`status = $${params.length}`); }
    if (!updates.length) return res.status(400).json({ error: 'nothing_to_update' });
    params.push(targetId, oid);
    const updated = await query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length - 1} AND org_id = $${params.length} AND deleted_at IS NULL
      RETURNING id, name, email, role, status, COALESCE(totp_enabled, false) AS totp_enabled, org_id, created_at, updated_at`, params);

    req.auditAction = 'UPDATE';
    req.auditRecordId = targetId;
    req.auditBefore = before.rows[0];
    req.auditAfter = updated.rows[0];
    res.json({ data: updated.rows[0] });
  } catch (err) {
    logger.error(`PATCH /auth/identity/users/:id error: ${err.message}`);
    res.status(500).json({ error: 'identity_user_update_failed' });
  }
});

router.get('/identity/sessions', async (req, res) => {
  const oid = orgId(req);
  if (!oid) return res.status(403).json({ error: 'identity_org_required' });
  try {
    const rows = await query(`SELECT rt.id, rt.user_id, u.name, u.email, u.role,
      rt.created_at, rt.expires_at, rt.last_seen_at, rt.ip_address, rt.user_agent,
      CASE WHEN rt.used_at IS NOT NULL OR rt.revoked_at IS NOT NULL OR rt.expires_at <= NOW() THEN 'revoked' ELSE 'active' END AS state
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE u.org_id = $1 AND u.deleted_at IS NULL
      ORDER BY CASE WHEN rt.used_at IS NULL AND rt.revoked_at IS NULL AND rt.expires_at > NOW() THEN 0 ELSE 1 END,
        rt.created_at DESC LIMIT 200`, [oid]);
    res.json({ data: rows.rows.map((r) => ({ ...r, token_fingerprint: crypto.createHash('sha256').update(String(r.id)).digest('hex').slice(0, 12) })) });
  } catch (err) {
    logger.error(`GET /auth/identity/sessions error: ${err.message}`);
    res.status(500).json({ error: 'identity_sessions_failed' });
  }
});

router.post('/identity/sessions/revoke-all', auditLog('identity_sessions'), async (req, res) => {
  const oid = orgId(req);
  if (!oid) return res.status(403).json({ error: 'identity_org_required' });
  try {
    const result = await query(`UPDATE refresh_tokens rt SET revoked_at = NOW(), used_at = COALESCE(used_at, NOW())
      FROM users u WHERE u.id = rt.user_id AND u.org_id = $1 AND rt.used_at IS NULL AND rt.expires_at > NOW()`, [oid]);
    req.auditAction = 'REVOKE_SESSIONS';
    req.auditRecordId = oid;
    req.auditBefore = { scope: 'organisation', active_sessions: result.rowCount };
    req.auditAfter = { scope: 'organisation', revoked: result.rowCount };
    res.json({ data: { revoked: result.rowCount } });
  } catch (err) {
    logger.error(`POST /auth/identity/sessions/revoke-all error: ${err.message}`);
    res.status(500).json({ error: 'identity_revoke_failed' });
  }
});

router.delete('/identity/sessions/:id', auditLog('identity_sessions'), async (req, res) => {
  const oid = orgId(req);
  if (!oid) return res.status(403).json({ error: 'identity_org_required' });
  try {
    const result = await query(`UPDATE refresh_tokens rt SET revoked_at = NOW(), used_at = COALESCE(used_at, NOW())
      FROM users u WHERE rt.id = $1 AND u.id = rt.user_id AND u.org_id = $2 AND rt.expires_at > NOW()
      RETURNING rt.id`, [req.params.id, oid]);
    if (!result.rows.length) return res.status(404).json({ error: 'session_not_found' });
    req.auditAction = 'REVOKE_SESSION';
    req.auditRecordId = req.params.id;
    res.status(204).end();
  } catch (err) {
    logger.error(`DELETE /auth/identity/sessions/:id error: ${err.message}`);
    res.status(500).json({ error: 'identity_session_revoke_failed' });
  }
});

router.get('/identity/access-requests', async (req, res) => {
  const oid = orgId(req);
  if (!oid) return res.status(403).json({ error: 'identity_org_required' });
  try {
    const rows = await query(`SELECT id, name, email, organization, role_requested, reason, status, reviewed_by, reviewed_at, created_at
      FROM identity_access_requests WHERE org_id = $1 ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 200`, [oid]);
    res.json({ data: rows.rows });
  } catch (err) {
    logger.error(`GET /auth/identity/access-requests error: ${err.message}`);
    res.status(500).json({ error: 'identity_access_requests_failed' });
  }
});

router.patch('/identity/access-requests/:id', auditLog('identity_access_requests'), async (req, res) => {
  const oid = orgId(req);
  if (!oid) return res.status(403).json({ error: 'identity_org_required' });
  const status = ['approved', 'rejected', 'cancelled'].includes(req.body && req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'invalid_request_status' });
  try {
    const result = await query(`UPDATE identity_access_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3 AND org_id = $4 AND status = 'pending'
      RETURNING id, name, email, organization, role_requested, reason, status, reviewed_by, reviewed_at, created_at`,
      [status, req.user.id, req.params.id, oid]);
    if (!result.rows.length) return res.status(404).json({ error: 'access_request_not_found_or_already_reviewed' });
    req.auditAction = 'REVIEW';
    req.auditRecordId = req.params.id;
    req.auditAfter = result.rows[0];
    res.json({ data: result.rows[0] });
  } catch (err) {
    logger.error(`PATCH /auth/identity/access-requests/:id error: ${err.message}`);
    res.status(500).json({ error: 'identity_access_request_update_failed' });
  }
});

module.exports = router;
