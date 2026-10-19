const { query } = require('../config/database');
const logger = require('../utils/logger');

const RESERVATION_STATUS = 102;
const IN_PROGRESS_RESPONSE = { state: 'in_progress' };

function requireIdempotencyKey(req, res, next) {
  const rawKey = req.headers['x-idempotency-key'];
  // Preserve compatibility for older online clients. Offline field clients send
  // a stable key; do not invent one when a caller omitted it.
  if (!rawKey) return next();
  if (typeof rawKey !== 'string' || !rawKey.trim() || rawKey.length > 200) {
    return res.status(400).json({ error: 'invalid_idempotency_key' });
  }

  const key = rawKey.trim();
  const orgId = req.user?.org_id;
  if (!orgId) return res.status(403).json({ error: 'tenant_scope_required' });

  (async () => {
    // Claim the key before executing a side effect. Concurrent inserts for the
    // same (tenant,key) serialize at the unique index. An expired record can be
    // reclaimed atomically; an active in-flight reservation cannot.
    const claim = await query(
      `INSERT INTO idempotency_keys (key, org_id, status_code, response, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW() + INTERVAL '24 hours')
       ON CONFLICT (key, org_id) DO UPDATE
         SET status_code = EXCLUDED.status_code,
             response = EXCLUDED.response,
             created_at = NOW(),
             expires_at = EXCLUDED.expires_at
       WHERE idempotency_keys.expires_at <= NOW()
       RETURNING key`,
      [key, orgId, RESERVATION_STATUS, JSON.stringify(IN_PROGRESS_RESPONSE)],
    );

    if (claim.rows.length > 0) {
      const originalJson = res.json.bind(res);
      let finalized = false;
      res.json = function (body) {
        if (finalized) return originalJson(body);
        finalized = true;
        const statusCode = res.statusCode || 200;

        if (statusCode >= 500) {
          // A transactional handler may be retried after a server error.
          return query(
            'DELETE FROM idempotency_keys WHERE key = $1 AND org_id = $2 AND status_code = $3',
            [key, orgId, RESERVATION_STATUS],
          ).then(() => originalJson(body)).catch((err) => {
            logger.error({ err, key, orgId }, 'Failed to release idempotency reservation after server error');
            return originalJson(body);
          });
        }

        // Persist the exact response before sending it. If receipt storage fails,
        // keep the reservation and return a retry-same-key response; do not let a
        // client unknowingly repeat a potentially committed physical operation.
        return query(
          `UPDATE idempotency_keys
              SET status_code = $3, response = $4::jsonb,
                  created_at = NOW(), expires_at = NOW() + INTERVAL '24 hours'
            WHERE key = $1 AND org_id = $2 AND status_code = $5`,
          [key, orgId, statusCode, JSON.stringify(body), RESERVATION_STATUS],
        ).then((saved) => {
          if (saved.rowCount === 0) throw new Error('idempotency_receipt_not_persisted');
          return originalJson(body);
        }).catch((err) => {
          logger.error({ err, key, orgId }, 'Failed to persist idempotency receipt');
          res.statusCode = 503;
          return originalJson({
            error: 'idempotency_receipt_unavailable',
            message: 'The operation outcome could not be safely confirmed. Retry only with the same idempotency key.',
          });
        });
      };
      return next();
    }

    const cached = await query(
      `SELECT status_code, response FROM idempotency_keys
        WHERE key = $1 AND org_id = $2 AND expires_at > NOW()`,
      [key, orgId],
    );
    if (!cached.rows.length) {
      // Fail closed if the reservation/result is unexpectedly absent. Do not
      // execute an untracked mutation when the idempotency state is ambiguous.
      return res.status(409).json({ error: 'idempotency_state_unavailable', retry_same_key: true });
    }
    if (cached.rows[0].status_code === RESERVATION_STATUS) {
      return res.status(409).json({
        error: 'idempotency_in_progress',
        message: 'A request with this key is already executing. Retry with the same key.',
      });
    }
    return res.status(cached.rows[0].status_code).json(cached.rows[0].response);
  })().catch(next);
}

module.exports = requireIdempotencyKey;
