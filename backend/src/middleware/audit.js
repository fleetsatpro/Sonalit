const crypto = require('crypto');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

/**
 * auditLog(tableName) — middleware factory.
 * Appends to audit_logs with a hash chain to detect tampering (T1.6).
 * Uses SELECT … FOR UPDATE on the latest row to prevent concurrent chain corruption.
 */
function auditLog(tableName) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      const result = originalJson(body);

      if (res.statusCode >= 200 && res.statusCode < 300 && req.auditAction) {
        const orgId = req.user?.org_id || null;
        const userId = req.user?.id || null;
        const payload = JSON.stringify({
          table: tableName,
          action: req.auditAction,
          record_id: req.auditRecordId,
          before: req.auditBefore,
          after: req.auditAfter,
          user_id: userId,
        });

        (async () => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            // Lock the latest row for this org to prevent concurrent chain splits (T1.6)
            const prev = await client.query(
              `SELECT id, hash FROM audit_logs WHERE org_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
              [orgId]
            );
            const prevHash = prev.rows[0]?.hash || null;
            const newHash = crypto.createHash('sha256')
              .update((prevHash || '') + payload)
              .digest('hex');

            await client.query(
              `INSERT INTO audit_logs
                 (table_name, record_id, action, old_data, new_data, user_id, org_id, hash, prev_hash, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
              [
                tableName,
                req.auditRecordId || null,
                req.auditAction,
                req.auditBefore ? JSON.stringify(req.auditBefore) : null,
                req.auditAfter ? JSON.stringify(req.auditAfter) : null,
                userId,
                orgId,
                newHash,
                prevHash,
              ]
            );
            await client.query('COMMIT');
          } catch (err) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            logger.error(`Audit log write failed: ${err.message}`);
          } finally {
            client.release();
          }
        })();
      }

      return result;
    };

    next();
  };
}

module.exports = { auditLog };
