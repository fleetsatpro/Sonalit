const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const RESERVATION_STATUS = 102;
const IN_PROGRESS_RESPONSE = { state: 'in_progress' };
const OUTCOME_UNKNOWN_STATUS = 409;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function requestFingerprint(req) {
  const canonical = JSON.stringify({
    method: String(req.method || 'GET').toUpperCase(),
    url: String(req.originalUrl || req.url || ''),
    actor: String(req.user?.id ?? req.user?.user_id ?? req.user?.sub ?? ''),
    authorization: stableValue(req.user?.permissions ?? req.user?.roles ?? req.user?.role ?? null),
    body: stableValue(req.body == null ? null : req.body),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function requireIdempotencyKey(req, res, next) {
  const rawKey = req.headers['x-idempotency-key'];
  // Preserve compatibility for older online clients. Offline field clients send
  // a stable key; never synthesize one for a physical operation.
  if (!rawKey) return next();
  if (typeof rawKey !== 'string' || !rawKey.trim() || rawKey.length > 200) {
    return res.status(400).json({ error: 'invalid_idempotency_key' });
  }

  const key = rawKey.trim();
  const orgId = req.user?.org_id;
  if (!orgId) return res.status(403).json({ error: 'tenant_scope_required' });
  const fingerprint = requestFingerprint(req);

  (async () => {
    // Reserve before entering the mutation. A pending row is never reclaimed
    // automatically after expiry: a crash may follow the business commit, and
    // replaying an unknown physical action is worse than requiring review.
    const claim = await query(
      `INSERT INTO idempotency_keys
         (key, org_id, status_code, response, request_hash, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW() + INTERVAL '24 hours')
       ON CONFLICT (key, org_id) DO UPDATE
         SET status_code = EXCLUDED.status_code,
             response = EXCLUDED.response,
             request_hash = EXCLUDED.request_hash,
             created_at = NOW(),
             expires_at = EXCLUDED.expires_at
       WHERE idempotency_keys.expires_at <= NOW()
         AND idempotency_keys.status_code <> $3
       RETURNING key`,
      [key, orgId, RESERVATION_STATUS, JSON.stringify(IN_PROGRESS_RESPONSE), fingerprint],
    );

    if (claim.rows.length > 0) {
      const originalJson = res.json.bind(res);
      let finalized = false;
      res.json = function (body) {
        if (finalized) return originalJson(body);
        finalized = true;
        const statusCode = res.statusCode || 200;

        if (statusCode >= 500) {
          // A 5xx does not prove that the domain transaction rolled back.
          // Preserve a permanent "outcome unknown" receipt rather than freeing
          // the key for a second physical action.
          const unknown = {
            error: 'idempotency_outcome_unknown',
            retry_same_key: true,
            message: 'The operation outcome could not be confirmed. Do not use a new key or repeat this physical action until its state has been reconciled.',
          };
          return query(
            `UPDATE idempotency_keys
                SET status_code = $3,
                    response = $4::jsonb,
                    expires_at = 'infinity'::timestamptz,
                    created_at = NOW()
              WHERE key = $1 AND org_id = $2
                AND status_code = $5 AND request_hash = $6
              RETURNING key`,
            [key, orgId, OUTCOME_UNKNOWN_STATUS, JSON.stringify(unknown), RESERVATION_STATUS, fingerprint],
          ).then((saved) => {
            if (!saved.rows.length) {
              logger.error({ key, orgId }, 'Idempotency reservation changed before unknown-outcome receipt could be stored');
            }
            res.statusCode = OUTCOME_UNKNOWN_STATUS;
            return originalJson(unknown);
          }).catch((err) => {
            // If this write fails, the pending reservation still cannot be
            // reclaimed after expiry, so the system remains fail-closed.
            logger.error({ err, key, orgId }, 'Failed to persist unknown-outcome idempotency receipt');
            res.statusCode = OUTCOME_UNKNOWN_STATUS;
            return originalJson(unknown);
          });
        }

        return query(
          `UPDATE idempotency_keys
              SET status_code = $3, response = $4::jsonb,
                  created_at = NOW(), expires_at = NOW() + INTERVAL '24 hours'
            WHERE key = $1 AND org_id = $2 AND status_code = $5
              AND request_hash = $6`,
          [key, orgId, statusCode, JSON.stringify(body), RESERVATION_STATUS, fingerprint],
        ).then((saved) => {
          if (saved.rowCount === 0) throw new Error('idempotency_receipt_not_persisted');
          return originalJson(body);
        }).catch((err) => {
          // The business operation may already have committed. Retain the
          // reservation and require reconciliation; never silently free the key.
          logger.error({ err, key, orgId }, 'Failed to persist idempotency receipt');
          res.statusCode = OUTCOME_UNKNOWN_STATUS;
          return originalJson({
            error: 'idempotency_outcome_unknown',
            retry_same_key: true,
            message: 'The operation outcome could not be confirmed. Do not repeat it until its state has been reconciled.',
          });
        });
      };
      return next();
    }

    const cachedRows = await query(
      `SELECT status_code, response, request_hash, expires_at <= NOW() AS expired
         FROM idempotency_keys
        WHERE key = $1 AND org_id = $2`,
      [key, orgId],
    );
    if (!cachedRows.rows?.length) {
      return res.status(409).json({
        error: 'idempotency_state_unavailable',
        retry_same_key: true,
        message: 'The operation outcome is not yet available. Retry with the same key only after checking its state.',
      });
    }

    const receipt = cachedRows.rows[0];
    if (receipt.request_hash && receipt.request_hash !== fingerprint) {
      return res.status(409).json({
        error: 'idempotency_key_reused_for_different_request',
        retry_same_key: false,
        message: 'This idempotency key is already bound to a different method, URL or request body.',
      });
    }

    if (receipt.status_code === RESERVATION_STATUS) {
      return res.status(409).json({
        error: receipt.expired ? 'idempotency_outcome_unknown' : 'idempotency_in_progress',
        retry_same_key: true,
        message: receipt.expired
          ? 'The reservation expired without a final receipt. Reconcile the operation before retrying it.'
          : 'A request with this key is still executing. Retry only with the same key.',
      });
    }

    return res.status(receipt.status_code).json(receipt.response);
  })().catch(next);
}

module.exports = requireIdempotencyKey;
module.exports.requestFingerprint = requestFingerprint;
