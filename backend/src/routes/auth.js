const router = require('express').Router();
const { login, getCurrentUser, logout, changePassword, hashToken, COOKIE_OPTS, RT_COOKIE, ensureRefreshTable } = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const logger = require('../utils/logger');

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
const VALID_ROLES = ['admin', 'dispatcher', 'operator', 'analyst', 'driver', 'cfo'];

router.post('/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, and role are required' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role, status, org_id)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING id, email, name, role, status`,
      [name, email, password_hash, role, req.user.org_id]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
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
      { expiresIn: '15m' }
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

module.exports = router;
