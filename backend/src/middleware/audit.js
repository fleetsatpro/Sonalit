const { query } = require('../config/database');
const logger = require('../utils/logger');

/**
 * auditLog(tableName) — middleware factory.
 * Captures the mutation (action, old data, new data) into audit_logs.
 * Attach AFTER the controller has written req.auditBefore (old snapshot)
 * and req.auditAfter (new snapshot).
 *
 * Controllers should set:
 *   req.auditAction = 'INSERT' | 'UPDATE' | 'DELETE'
 *   req.auditRecordId = uuid
 *   req.auditBefore = object | null
 *   req.auditAfter  = object | null
 */
function auditLog(tableName) {
  return async (req, res, next) => {
    // Patch res.json to intercept the response and write the audit log after it sends
    const originalJson = res.json.bind(res);
    res.json = async function (body) {
      originalJson(body);

      // Only log successful mutations
      if (res.statusCode >= 200 && res.statusCode < 300 && req.auditAction) {
        try {
          await query(
            `INSERT INTO audit_logs
               (table_name, record_id, action, old_data, new_data, user_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
              tableName,
              req.auditRecordId || null,
              req.auditAction,
              req.auditBefore ? JSON.stringify(req.auditBefore) : null,
              req.auditAfter ? JSON.stringify(req.auditAfter) : null,
              req.user?.id || null,
            ]
          );
        } catch (err) {
          // Audit failures must never crash the request
          logger.error(`Audit log write failed: ${err.message}`);
        }
      }
    };

    next();
  };
}

module.exports = { auditLog };
