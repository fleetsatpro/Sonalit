const { query } = require('../config/database');

function requireIdempotencyKey(req, res, next) {
  const key = req.headers['x-idempotency-key'];
  if (!key) return next();

  const orgId = (req.user && req.user.org_id) || 'anonymous';

  (async () => {
    try {
      const cached = await query(
        `SELECT status_code, response FROM idempotency_keys
         WHERE key = $1 AND org_id = $2 AND expires_at > NOW()`,
        [key, orgId]
      );
      if (cached.rows.length) {
        return res.status(cached.rows[0].status_code).json(cached.rows[0].response);
      }

      const origJson = res.json.bind(res);
      res.json = function (body) {
        const sc = res.statusCode || 200;
        // Never cache a 5xx. The point of an idempotency key is "don't repeat
        // the side effect", but a 5xx means the side effect may not have
        // happened at all — and caching it would replay that failure for the
        // full 24h TTL, so a single transient blip would permanently block the
        // client from ever retrying that action. 2xx/4xx are deterministic
        // outcomes and stay cached.
        if (sc < 500) {
          query(
            `INSERT INTO idempotency_keys (key, org_id, status_code, response, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')
             ON CONFLICT (key, org_id) DO NOTHING`,
            [key, orgId, sc, JSON.stringify(body)]
          ).catch(() => {});
        }
        return origJson(body);
      };
      next();
    } catch (err) {
      next(err);
    }
  })();
}

module.exports = requireIdempotencyKey;
