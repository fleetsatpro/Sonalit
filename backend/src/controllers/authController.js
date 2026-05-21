const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Joi = require('joi');
const { query, pool } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const logger = require('../utils/logger');

// Refresh token TTL: 30 days
const REFRESH_TTL_DAYS = 30;
const RT_COOKIE = 'sonalit_rt';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
};

// Ensure refresh_tokens table exists (idempotent; runs once at startup)
let _rtTableReady = false;
async function ensureRefreshTable() {
  if (_rtTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  _rtTableReady = true;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function issueRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

async function setRefreshCookie(res, userId, reuseToken) {
  const raw = reuseToken || issueRefreshToken();
  const hash = hashToken(raw);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${REFRESH_TTL_DAYS} days')`,
    [userId, hash]
  );
  res.cookie(RT_COOKIE, raw, COOKIE_OPTS);
  return raw;
}

const loginSchema = Joi.object({
  email: Joi.string().required(),
  password: Joi.string().min(6).required(),
});

const login = asyncHandler(async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const { email, password } = value;
  await ensureRefreshTable();

  const result = await query(
    'SELECT id, email, name, role, status, org_id, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL',
    [email]
  );
  const user = result.rows[0];

  // Constant-time comparison — always hash even if user not found
  const hashToCompare = user ? user.password_hash : '$2a$10$dummyhashtopreventtimingattacks00000000000';
  const valid = await bcrypt.compare(password, hashToCompare);

  if (!user || !valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Account is suspended' });
  }

  // Access token: short-lived, lives in memory on the client (not localStorage)
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  // Refresh token: long-lived, httpOnly cookie (T1.2)
  await setRefreshCookie(res, user.id);

  logger.info(`Login: ${user.email} (${user.role})`);
  res.json({
    token: accessToken,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, org_id: user.org_id },
  });
});

const getCurrentUser = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, email, name, role, status, org_id, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json({ user: result.rows[0] });
});

const logout = asyncHandler(async (req, res) => {
  // Revoke the refresh token stored in the httpOnly cookie
  const raw = req.cookies && req.cookies[RT_COOKIE];
  if (raw) {
    await query('UPDATE refresh_tokens SET used_at = NOW() WHERE token_hash = $1', [hashToken(raw)]).catch(() => {});
  }
  // Clear the cookie
  res.clearCookie(RT_COOKIE, { ...COOKIE_OPTS, maxAge: 0 });
  logger.info(`Logout: ${req.user.email}`);
  res.json({ message: 'Logged out successfully' });
});

const changePassword = asyncHandler(async (req, res) => {
  const schema = Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const valid = await bcrypt.compare(value.currentPassword, result.rows[0].password_hash);
  if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(value.newPassword, 10);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.user.id;
  req.auditBefore = { password_hash: '[REDACTED]' };
  req.auditAfter = { password_hash: '[REDACTED]' };

  res.json({ message: 'Password updated successfully' });
});

module.exports = { login, getCurrentUser, logout, changePassword, hashToken, COOKIE_OPTS, RT_COOKIE, ensureRefreshTable };
