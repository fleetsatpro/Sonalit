const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { attachOrgDb } = require('../utils/orgScopedDb');
const logger = require('../utils/logger');

// The office ladder only. Scoped field roles (yard_agent, port_agent,
// response_crew, handover_officer) are deliberately absent: they reach their
// own routes by exact match, and an entry here would also hand them every route
// that admits an equal or lower level. response_crew and handover_officer sat
// at level 1 alongside analyst and cfo, which granted them the six convoy
// reporting routes in routes/convoys.js — reports overview, per-convoy reports,
// report days, report detail, report download and route waypoints — none of
// which either role has any reason to read. Everything they are meant to reach
// (routes/response-crew.js, routes/convoyHandover.js, the role checks in
// routes/handoverPin.js and routes/field.js) names them explicitly and is
// unaffected.
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
 *
 * Two ways in: an exact match against `allowedRoles` always passes, which is
 * how scoped roles outside ROLE_HIERARCHY (yard_agent, port_agent — see
 * migration 077) get through routes that explicitly list them, without
 * gaining anything via the hierarchy fallback below. Failing that, the usual
 * hierarchy check applies for admin/dispatcher/operator/analyst/cfo.
 */
function authorize(...allowedRoles) {
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (roles.includes(req.user.role)) return next();
    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const hasAccess = roles.some((r) => ROLE_HIERARCHY[r] !== undefined && ROLE_HIERARCHY[r] <= userLevel);
    if (!hasAccess) {
      return res.status(403).json({
        error: `Access denied. Required: ${roles.join(' or ')}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
