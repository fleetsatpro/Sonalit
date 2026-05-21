const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { attachOrgDb } = require('../utils/orgScopedDb');
const logger = require('../utils/logger');

const ROLE_HIERARCHY = { admin: 4, dispatcher: 3, operator: 2, analyst: 1, cfo: 1 };

/**
 * Verifies Bearer JWT and attaches req.user (full DB row including org_id).
 * Also attaches req.db / req.dbTx for org-scoped queries (T1.1).
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.slice(7);
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
      return res.status(401).json({ error: message });
    }

    // Include org_id so req.db can scope queries correctly (T1.1)
    const result = await query(
      'SELECT id, email, name, role, status, org_id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [decoded.id]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    req.user = user;

    // Attach org-scoped DB helpers (no-op if org_id is null — legacy rows)
    attachOrgDb(req, res, next);
  } catch (err) {
    logger.error(`authenticate middleware error: ${err.message}`);
    next(err);
  }
}

/**
 * Role-based access control.
 * @param {string[]} allowedRoles - Array of roles that may access the route.
 */
function authorize(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const hasAccess = roles.some((r) => ROLE_HIERARCHY[r] <= userLevel);
    if (!hasAccess) {
      return res.status(403).json({
        error: `Access denied. Required: ${roles.join(' or ')}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
