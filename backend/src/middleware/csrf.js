const crypto = require('crypto');

// __Host- prefix enforces Secure + Path=/ — only strip in non-HTTPS dev
const CSRF_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-csrf' : 'csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// These paths authenticate via non-cookie means or are called by external systems
const SKIP_PREFIXES = [
  '/api/v1/guardian/',  // X-Device-Token auth
  '/api/v1/webhooks/',  // Convoy / external webhook callbacks
  '/health',
  '/metrics',
];

function csrf(req, res, next) {
  let token = req.cookies[CSRF_COOKIE];
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    const opts = { httpOnly: false, sameSite: 'strict', path: '/' };
    if (process.env.NODE_ENV === 'production') opts.secure = true;
    res.cookie(CSRF_COOKIE, token, opts);
  }

  if (SAFE_METHODS.has(req.method)) return next();
  if (SKIP_PREFIXES.some(p => req.path.startsWith(p))) return next();

  const header = req.headers[CSRF_HEADER];
  const tokenBuf = Buffer.from(token);
  const headerBuf = header ? Buffer.from(header) : null;
  const valid = headerBuf && headerBuf.length === tokenBuf.length &&
    crypto.timingSafeEqual(headerBuf, tokenBuf);
  if (!valid) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  return next();
}

module.exports = csrf;
