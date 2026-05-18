const router = require('express').Router();
const { login, getCurrentUser, logout, changePassword } = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/auth');
const { auditLog } = require('../middleware/audit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('../utils/logger');

router.post('/login', login);
router.get('/me', authenticate, getCurrentUser);
router.post('/logout', authenticate, logout);
router.put('/change-password', authenticate, auditLog('users'), changePassword);

/**
 * POST /api/v1/auth/refresh
 * Exchange a refresh token for a new short-lived access JWT.
 * Refresh tokens are stored in the refresh_tokens table (created on first use).
 */
/**
 * GET /api/v1/auth/users
 * Returns users filtered by role. Admin/dispatcher only.
 */
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

router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token is required' });
    }

    // Ensure table exists (idempotent)
    await query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {}); // ignore if already exists and CREATE fails for any reason

    const result = await query(
      `SELECT rt.*, u.id AS uid, u.email, u.name, u.role, u.status
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1 AND rt.used_at IS NULL AND rt.expires_at > NOW()
         AND u.deleted_at IS NULL`,
      [refresh_token]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const row = result.rows[0];
    if (row.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    // Rotate: mark old token used, issue new refresh token
    await query(
      `UPDATE refresh_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id]
    );

    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [row.uid, newRefreshToken]
    );

    const accessToken = jwt.sign(
      { id: row.uid, email: row.email, role: row.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    logger.info(`Token refreshed for user ${row.email}`);
    res.json({ token: accessToken, refresh_token: newRefreshToken });
  } catch (err) {
    logger.error(`Token refresh error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
