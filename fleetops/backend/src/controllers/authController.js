const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const logger = require('../utils/logger');

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
});

const login = asyncHandler(async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const { email, password } = value;

  const result = await query(
    'SELECT id, email, name, role, status, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL',
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

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '24h' }
  );

  logger.info(`Login: ${user.email} (${user.role})`);

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

const getCurrentUser = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, email, name, role, status, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json({ user: result.rows[0] });
});

const logout = asyncHandler(async (req, res) => {
  // Token invalidation is handled client-side; log the event server-side
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

module.exports = { login, getCurrentUser, logout, changePassword };
