const router = require('express').Router();
const { login, getCurrentUser, logout, changePassword, hashToken, COOKIE_OPTS, RT_COOKIE, ensureRefreshTable } = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const logger = require('../utils/logger');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const { sendMail } = require('../utils/mailer');

router.post('/login', login);
router.get('/me', authenticate, getCurrentUser);
router.post('/logout', authenticate, logout);
router.put('/change-password', authenticate, auditLog('users'), changePassword);

// ─── GET /api/v1/auth/users ───────────────────────────────────────────────────
router.get('/users', authenticate, authorize('admin', 'dispatcher'), async (req, res) => {
  try {
    const { role, limit = 100, offset = 0 } = req.query;
    const conditions = ['deleted_at IS NULL'];
    const params = [];
    if (role) {
      params.push(role);
      conditions.push(`role = $${params.length}`);
    }
    params.push(Number(limit), Number(offset));
    const result = await query(
      `SELECT id, email, name, role, status FROM users WHERE ${conditions.join(' AND ')} ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    logger.error(`GET /auth/users error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/v1/auth/users ──────────────────────────────────────────────────
// yard_agent/port_agent are scoped CDS field-crew roles — see
// backend/migrations/20260814_077_cds_field_agent_roles.sql and the
// authorize()/field-role gating in backend/src/routes/cds.js. They sit
// outside ROLE_HIERARCHY on purpose: least privilege, not a rung on the
// admin>dispatcher>operator ladder.
//
// This list must stay in step with the users_role_check constraint: anything
// here that the constraint rejects is a 500 waiting for whoever picks it.
// 'driver' was exactly that — offered by this endpoint, rejected by the
// database. Drivers are their own table (migration 000) and nothing reads
// users.role === 'driver', so the stale entry goes rather than the constraint
// growing a role that would carry no permissions and mean nothing.
const VALID_ROLES = ['admin', 'dispatcher', 'operator', 'analyst', 'cfo', 'yard_agent', 'port_agent', 'response_crew', 'handover_officer'];

router.post('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, and role are required' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'email must be a valid email address' });
    }
    // Normalise like every lookup does (login's `LOWER(email) = $1`, etc.) —
    // otherwise "Foo@x.com" and "foo@x.com " both pass the DB's case- and
    // whitespace-sensitive UNIQUE constraint as distinct rows, and any query
    // matching on LOWER(email) becomes ambiguous between them.
    const emailClean = email.trim().toLowerCase();
    const password_hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role, status, org_id)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id, email, name, role, status`,
      [name.trim(), emailClean, password_hash, role, req.user.org_id]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'duplicate_email',
        message: 'An account with this email address already exists. If you need to change the role of an existing account, edit the account directly rather than creating a new one.',
      });
    }
    logger.error(`POST /auth/users error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/v1/auth/cfo-assignments ────────────────────────────────────────
// CFO users with their current convoy assignment (most recent active)
router.get('/cfo-assignments', authenticate, authorize('admin', 'dispatcher'), async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT ON (u.id)
         u.id, u.name, u.email, u.status,
         cc.id AS assignment_id,
         c.id   AS convoy_id,
         c.name AS convoy_name,
         c.status AS convoy_status
       FROM users u
       LEFT JOIN convoy_cfos cc ON cc.cfo_user_id = u.id
       LEFT JOIN convoys c ON c.id = cc.convoy_id AND c.deleted_at IS NULL
       WHERE u.role = 'cfo' AND u.deleted_at IS NULL AND u.org_id = $1
       ORDER BY u.id, c.created_at DESC NULLS LAST`,
      [req.user.org_id]
    );
    res.json({ data: result.rows });
  } catch (err) {
    logger.error(`GET /auth/cfo-assignments error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /api/v1/auth/users/:id ────────────────────────────────────────────
router.patch('/users/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, password } = req.body;
    const updates = [];
    const params = [];
    if (name) { params.push(name.trim()); updates.push(`name = $${params.length}`); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      params.push(hash);
      updates.push(`password_hash = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id, req.user.org_id);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length - 1} AND org_id = $${params.length} AND deleted_at IS NULL
       RETURNING id, email, name, role, status`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    logger.error(`PATCH /auth/users/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/v1/auth/users/:id ───────────────────────────────────────────
router.delete('/users/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query(
      `UPDATE users SET deleted_at = NOW(), status = 'inactive'
       WHERE id = $1 AND deleted_at IS NULL AND org_id = $2 RETURNING id`,
      [req.params.id, req.user.org_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.status(204).end();
  } catch (err) {
    logger.error(`DELETE /auth/users/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/v1/auth/refresh ────────────────────────────────────────────────
// Reads refresh token from httpOnly cookie (T1.2).
// Infinite-loop guard: if the request itself is a refresh attempt and the cookie
// is absent/invalid we return 401 immediately — the frontend interceptor must not
// retry this endpoint on 401 (loop guard lives in apps/web/src/lib/api.ts).
router.post('/refresh', async (req, res) => {
  try {
    await ensureRefreshTable();

    const raw = req.cookies && req.cookies[RT_COOKIE];
    if (!raw) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    const hash = hashToken(raw);
    const result = await query(
      `SELECT rt.*, u.id AS uid, u.email, u.name, u.role, u.org_id, u.status
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.used_at IS NULL AND rt.expires_at > NOW()
         AND u.deleted_at IS NULL`,
      [hash]
    );

    if (!result.rows.length) {
      res.clearCookie(RT_COOKIE, { ...COOKIE_OPTS, maxAge: 0 });
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const row = result.rows[0];
    if (row.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }
    // Field roles are barred from POST /auth/login (see authController), but a
    // refresh cookie minted before that rule existed — or before an account
    // was moved to a field role — would otherwise keep renewing an operator
    // session indefinitely.
    if (row.role === 'yard_agent' || row.role === 'port_agent') {
      res.clearCookie(RT_COOKIE, { ...COOKIE_OPTS, maxAge: 0 });
      return res.status(403).json({ error: 'field_account' });
    }

    // Rotate: mark old token used, issue new httpOnly cookie
    await query('UPDATE refresh_tokens SET used_at = NOW() WHERE id = $1', [row.id]);

    const newRaw = crypto.randomBytes(40).toString('hex');
    const newHash = hashToken(newRaw);
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [row.uid, newHash]
    );
    res.cookie(RT_COOKIE, newRaw, COOKIE_OPTS);

    const accessToken = jwt.sign(
      { id: row.uid, email: row.email, role: row.role },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    logger.info(`Token refreshed for user ${row.email}`);
    res.json({
      token: accessToken,
      user: { id: row.uid, email: row.email, name: row.name, role: row.role, org_id: row.org_id },
    });
  } catch (err) {
    logger.error(`Token refresh error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/v1/auth/request-access ─────────────────────────────────────────
// Public, pre-auth. Backs two forms: the "Request access" dialog on /login
// (source: 'login') and the enquiry form on the public /contact page
// (source: 'contact'). Both existed in the UI long before this endpoint did —
// the login dialog has been posting into a 404 and reporting a generic failure.
//
// The row is written first and the email sent second, on purpose: if no mail
// provider is configured, or the provider is down, the request is still
// recorded rather than lost. `notified` records which happened, and the
// partial index on it gives ops a way to find anything that needs picking up
// by hand.
const accessRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests, please try again later.' },
});

const accessRequestSchema = Joi.object({
  // .trim() before .email(): mobile keyboards and autocomplete routinely append
  // a trailing space, and Joi validates the raw string otherwise — which
  // rejected perfectly good addresses with a 400.
  email: Joi.string().trim().email({ minDomainSegments: 2 }).max(320).required(),
  organization: Joi.string().trim().max(200).allow('', null),
  name: Joi.string().trim().max(120).allow('', null),
  message: Joi.string().trim().max(4000).allow('', null),
  source: Joi.string().valid('login', 'contact').default('login'),
});

router.post('/request-access', accessRequestLimiter, async (req, res) => {
  const { error, value } = accessRequestSchema.validate(req.body ?? {});
  if (error) return res.status(400).json({ error: error.message });

  const email = value.email.toLowerCase().trim();
  const organization = value.organization?.trim() || null;
  const name = value.name?.trim() || null;
  const message = value.message?.trim() || null;

  let requestId;
  try {
    const result = await query(
      `INSERT INTO access_requests (source, name, email, organization, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [value.source, name, email, organization, message]
    );
    requestId = result.rows[0].id;
  } catch (err) {
    logger.error(`request-access persist failed for ${email}: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }

  // Best effort from here: the request is safely recorded, so a mail failure
  // must not read to the visitor as "your enquiry did not go through".
  try {
    const to = process.env.ACCESS_REQUEST_TO || 'ops@sonalit.com';
    const label = value.source === 'contact' ? 'Contact enquiry' : 'Access request';
    const sent = await sendMail({
      to,
      replyTo: email,
      subject: `${label} — ${organization || email}`,
      text: [
        `${label} from the Sonalit website.`,
        '',
        `Email:        ${email}`,
        `Organisation: ${organization || '—'}`,
        `Name:         ${name || '—'}`,
        '',
        message ? `Message:\n${message}` : 'No message supplied.',
        '',
        `Reference: ${requestId}`,
      ].join('\n'),
    });

    if (sent) {
      await query(`UPDATE access_requests SET notified = TRUE WHERE id = $1`, [requestId]);
    } else {
      logger.warn(`request-access ${requestId} stored but no mail provider configured`);
    }
  } catch (err) {
    logger.error(`request-access ${requestId} stored but notification failed: ${err.message}`);
  }

  res.status(202).json({ data: { ok: true } });
});

module.exports = router;
