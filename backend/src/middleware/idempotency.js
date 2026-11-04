const { pool } = require('../config/database');
const logger = require('../utils/logger');

function requireIdempotencyKey(req, res, next) {
  const header = req.headers['x-idempotency-key'];
  if (!header) return next();

  const key = Array.isArray(header) ? header[0] : String(header);
  if (!key || !key.trim() || key.length > 200) {
    return res.status(400).json({ error: 'invalid_idempotency_key' });
  }

  const orgId = req.user?.org_id;
  if (!orgId) return res.status(403).json({ error: 'tenant_scope_required' });

  (async () => {
    let client = null;
    let locked = false;
    let released = false;
    let cachePromise = null;
    let releaseTimer = null;
    const lockName = `sonalit:idempotency:${orgId}:${key}`;

    const release = async () => {
      if (released) return;
      released = true;
      if (releaseTimer) clearTimeout(releaseTimer);

      // Keep the advisory lock until the response cache is durably written.
      // A second request with the same key then sees the original response,
      // even when it arrived while the first operation was still committing.
      if (cachePromise) {
        try { await cachePromise; } catch (_) {}
      }
      if (client) {
        if (locked) {
          try {
            await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]);
          } catch (err) {
            logger.warn(`Idempotency advisory unlock failed: ${err.message}`);
          }
        }
        client.release();
      }
    };

    try {
      // A session-level advisory lock serialises requests by (organisation,
      // key). Unlike a cache lookup followed by an INSERT, this closes the
      // race where two identical POSTs both see an empty cache and each run
      // the business mutation.
      client = await pool.connect();
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockName]);
      locked = true;

      const cached = await client.query(
        `SELECT status_code, response FROM idempotency_keys
         WHERE key = $1 AND org_id = $2 AND expires_at > NOW()`,
        [key, orgId]
      );
      if (cached.rows.length) {
        res.status(cached.rows[0].status_code).json(cached.rows[0].response);
        await release();
        return;
      }

      const origJson = res.json.bind(res);
      res.json = function (body) {
        const statusCode = res.statusCode || 200;
        // Never cache a 5xx. The side effect may not have happened, so keeping
        // that failure for 24h would permanently prevent a legitimate retry.
        if (statusCode < 500) {
          cachePromise = client.query(
            `INSERT INTO idempotency_keys (key, org_id, status_code, response, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')
             ON CONFLICT (key, org_id) DO UPDATE
               SET status_code = EXCLUDED.status_code,
                   response = EXCLUDED.response,
                   created_at = NOW(),
                   expires_at = EXCLUDED.expires_at`,
            [key, orgId, statusCode, JSON.stringify(body)]
          ).catch(err => {
            logger.error(`Idempotency response cache failed: ${err.message}`);
          });
        }
        return origJson(body);
      };

      // The normal path releases after Express flushes the response. The close
      // handler covers clients that disconnect after the route staged a JSON
      // response; the bounded fallback prevents a checked-out connection from
      // being stranded if a handler never reaches its response path.
      const onFinish = () => { void release(); };
      res.once('finish', onFinish);
      res.once('close', () => {
        if (res.writableFinished || cachePromise) {
          void release();
          return;
        }
        releaseTimer = setTimeout(() => { void release(); }, 35_000);
        if (typeof releaseTimer.unref === 'function') releaseTimer.unref();
      });
      releaseTimer = setTimeout(() => { void release(); }, 35_000);
      if (typeof releaseTimer.unref === 'function') releaseTimer.unref();

      next();
    } catch (err) {
      await release();
      next(err);
    }
  })();
}

module.exports = requireIdempotencyKey;
