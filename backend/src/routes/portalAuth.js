/**
 * Portal client auth routes.
 *
 * POST /api/v1/portal/auth/request-link  — send magic-link email
 * POST /api/v1/portal/auth/verify        — exchange token for session JWT
 * POST /api/v1/portal/auth/logout        — clear session cookie
 * GET  /api/v1/portal/auth/rt-token      — Centrifugo connection token (clientAuth)
 */
const router = require('express').Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/database');
const { asyncHandler } = require('../middleware/error');
const { clientAuth } = require('../middleware/clientAuth');

// Rate limit: 5 requests / 15 min / IP for magic-link requests
const requestLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many login attempts, please try again later.' },
});

function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
}

// POST /portal/auth/request-link
router.post('/request-link', requestLinkLimiter, asyncHandler(async (req, res) => {
  const email = (req.body.email ?? '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email required' });

  // Always return 200 — no account enumeration
  const clientResult = await query(
    `SELECT id, org_id FROM cargo_clients WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
    [email],
  );

  if (clientResult.rows.length) {
    const { id: client_id, org_id } = clientResult.rows[0];

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await query(
      `INSERT INTO client_magic_links (org_id, client_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [org_id, client_id, tokenHash, expiresAt],
    );

    const portalUrl = process.env.PORTAL_URL ?? 'https://app.sonalit.io';
    const magicLink = `${portalUrl}/portal/login?token=${rawToken}`;

    const transporter = createTransporter();
    if (transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@sonalit.io',
        to: email,
        subject: 'Your SONALIT login link',
        text: `Hello,\n\nClick the link below to log in to your SONALIT cargo portal. This link expires in 15 minutes.\n\n${magicLink}\n\nIf you did not request this, you can safely ignore this email.\n`,
      });
    }
  }

  res.json({ message: 'If that email is registered, a login link has been sent.' });
}));

// POST /portal/auth/verify
router.post('/verify', asyncHandler(async (req, res) => {
  const rawToken = (req.body.token ?? '').trim();
  if (!rawToken) return res.status(400).json({ error: 'token required' });

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const linkResult = await query(
    `SELECT id, client_id, org_id, expires_at, used_at
       FROM client_magic_links
      WHERE token_hash = $1`,
    [tokenHash],
  );

  if (!linkResult.rows.length) {
    return res.status(401).json({ error: 'Invalid or expired link' });
  }

  const link = linkResult.rows[0];

  if (link.used_at || new Date(link.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Invalid or expired link' });
  }

  // Mark as used
  await query(
    `UPDATE client_magic_links SET used_at = NOW() WHERE id = $1`,
    [link.id],
  );

  // Load linked convoy_ids
  const linksResult = await query(
    `SELECT convoy_id FROM cargo_client_links WHERE client_id = $1`,
    [link.client_id],
  );
  const convoy_ids = linksResult.rows.map(r => r.convoy_id);

  const secret = process.env.CLIENT_JWT_SECRET;
  if (!secret) return res.status(503).json({ error: 'Auth not configured' });

  const token = jwt.sign(
    { client_id: link.client_id, org_id: link.org_id, convoy_ids },
    secret,
    { expiresIn: '24h', algorithm: 'HS256' },
  );

  res.cookie('sonalit_client', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 86400000,
  });

  // Update last_login_at (best-effort)
  query(
    `UPDATE cargo_clients SET last_login_at = NOW() WHERE id = $1`,
    [link.client_id],
  ).catch(() => {});

  res.json({ data: { client_id: link.client_id, org_id: link.org_id, convoy_ids } });
}));

// POST /portal/auth/logout
router.post('/logout', asyncHandler(async (req, res) => {
  res.clearCookie('sonalit_client');
  res.json({ ok: true });
}));

// GET /portal/auth/rt-token — Centrifugo connection token for portal clients
router.get('/rt-token', clientAuth, asyncHandler(async (req, res) => {
  const secret = process.env.CENTRIFUGO_TOKEN_HMAC_SECRET;
  if (!secret) return res.status(503).json({ error: 'Realtime not configured' });
  const cfToken = jwt.sign(
    { sub: `portal_client:${req.client.client_id}` },
    secret,
    { expiresIn: '1h', algorithm: 'HS256' },
  );
  res.json({ data: { token: cfToken } });
}));

module.exports = router;
