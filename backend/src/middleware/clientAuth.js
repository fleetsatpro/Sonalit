/**
 * clientAuth — validates a cargo-client session JWT (httpOnly cookie or Bearer header).
 * Sets req.client = { client_id, org_id, convoy_ids: string[] }.
 * Every data endpoint enforces convoy_id ∈ req.client.convoy_ids.
 */
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

async function clientAuth(req, res, next) {
  try {
    const fromCookie = req.cookies?.sonalit_client;
    const fromHeader = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const token = fromCookie || fromHeader;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const secret = process.env.CLIENT_JWT_SECRET ?? process.env.JWT_SECRET;
    if (!secret) return res.status(503).json({ error: 'Auth not configured' });

    const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });

    if (!claims.client_id || !claims.org_id) {
      return res.status(401).json({ error: 'Invalid client session' });
    }

    // Resolve the current client/convoy relationship instead of trusting the
    // snapshot embedded in the JWT. This makes newly-created or repaired
    // convoy links available immediately without re-login.
    const access = await query(
      `SELECT cc.id AS client_id, cc.org_id,
              ARRAY(
                SELECT DISTINCT ccl.convoy_id
                FROM cargo_client_links ccl
                JOIN convoys c_link ON c_link.id = ccl.convoy_id
                WHERE ccl.client_id = cc.id
                  AND ccl.org_id = cc.org_id
                  AND c_link.org_id = cc.org_id
                  AND c_link.deleted_at IS NULL
              ) AS convoy_ids
       FROM cargo_clients cc
      WHERE cc.id = $1
        AND cc.org_id = $2
        AND cc.deleted_at IS NULL`,
      [claims.client_id, claims.org_id],
    );

    if (!access.rows.length) {
      return res.status(401).json({ error: 'Client account is unavailable' });
    }

    req.client = {
      client_id: access.rows[0].client_id,
      org_id: access.rows[0].org_id,
      convoy_ids: Array.isArray(access.rows[0].convoy_ids) ? access.rows[0].convoy_ids : [],
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { clientAuth };
