/**
 * clientAuth — validates a cargo-client session JWT (httpOnly cookie or Bearer header).
 * Sets req.client = { client_id, org_id, convoy_ids: string[] }.
 * Every data endpoint enforces convoy_id ∈ req.client.convoy_ids.
 */
const jwt = require('jsonwebtoken');

function clientAuth(req, res, next) {
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
    req.client = {
      client_id: claims.client_id,
      org_id: claims.org_id,
      convoy_ids: claims.convoy_ids ?? [],
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { clientAuth };
