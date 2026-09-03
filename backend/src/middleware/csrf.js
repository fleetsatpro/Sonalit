const crypto = require('crypto');

// __Host- prefix enforces Secure + Path=/ — only strip in non-HTTPS dev
const CSRF_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-csrf' : 'csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// These paths authenticate via non-cookie means or are called by external systems
const SKIP_PREFIXES = [
  // Pre-auth endpoints: no session exists yet, so there is nothing to forge.
  // Login CSRF (forcing a victim to sign in as someone else) is a distinct,
  // lower-severity class and does not require double-submit protection.
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/webauthn/',  // challenge fetch + assertion are pre-auth
  // Portal magic-link auth: one-time token sent to user's email IS the credential.
  // The verify endpoint is called immediately on landing from an email link
  // (no prior session = no CSRF cookie). Same pre-auth rationale as /auth/login.
  '/api/v1/portal/auth/',
  // Portal client data routes: authenticated via sonalit_client cookie which has
  // sameSite: 'strict' — cross-site requests cannot include it, so double-submit
  // CSRF is redundant. Portal pages also use bare fetch() without the CSRF header.
  '/api/v1/portal/',
  '/api/v1/guardian/',          // X-Device-Token auth
  // Field app device/session endpoints: X-Field-Device / X-Field-Token auth,
  // no cookies involved at all, so there is no ambient credential to forge.
  // Only the /app/ half is exempt — /field/admin/* is ordinary operator JWT
  // and stays behind double-submit like the rest of the dashboard.
  '/api/v1/field/app/',
  // Driver tracking activation + telemetry. The credential is an opaque QR
  // token in the path (spent on first use) or a session token in
  // X-Tracking-Session — never a cookie, so there is no ambient credential a
  // third-party page could ride. Only /track/ is exempt; the operator-facing
  // /api/v1/tracking/** management routes stay behind double-submit.
  '/api/v1/track/',
  '/api/v1/webhooks/',          // Convoy / external webhook callbacks
  '/api/v1/fuel/webhook/',                 // Fuel-card webhook — HMAC-verified (RULE D)
  '/api/v1/guardian/whatsapp/webhook',     // WhatsApp webhook — HMAC-verified (RULE D)
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

  // Field app requests to shared routers (notably /api/v1/cds/**, which serves
  // both the dashboard and the yard/port tablets). The credential is a custom
  // header the browser will not attach on its own, so the request cannot be
  // forged cross-site the way a cookie-authenticated one can — the same
  // reasoning that exempts the Guardian X-Device-Token API above. Presenting
  // the header does not grant anything: fieldAuth still has to resolve it.
  if (req.headers['x-field-token'] || req.headers['x-field-device']) return next();

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
