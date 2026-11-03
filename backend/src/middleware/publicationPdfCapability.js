const jwt = require('jsonwebtoken');
const { globalQuery } = require('../config/database');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { authenticate, authorize } = require('./auth');

const PDF_CAPABILITY_COOKIE = 'sonalit_pdf_capability';
const PDF_CAPABILITY_PATH = '/api/v1/admin/communications/publications';
const PDF_CAPABILITY_MAX_AGE_MS = 10 * 60 * 1000;

function issuePublicationPdfCapability(res, user) {
  const token = jwt.sign(
    { sub: user.id, org_id: user.org_id, role: user.role, aud: 'publication-pdf' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
  res.cookie(PDF_CAPABILITY_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: PDF_CAPABILITY_PATH,
    maxAge: PDF_CAPABILITY_MAX_AGE_MS,
  });
}

async function authenticatePublicationPdfCapability(req, res, next) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader) {
    // This compatibility route is mounted before the admin router's global
    // role gate, so bearer authentication must enforce that gate explicitly.
    return authenticate(req, res, (error) => {
      if (error) return next(error);
      return authorize('admin', 'super_admin')(req, res, next);
    });
  }

  const raw = req.cookies?.[PDF_CAPABILITY_COOKIE];
  if (!raw) return next();

  try {
    const decoded = jwt.verify(raw, process.env.JWT_SECRET, { audience: 'publication-pdf' });
    const userId = String(decoded.sub || '');
    const orgId = String(decoded.org_id || '');
    if (!userId || !orgId) return res.status(401).json({ error: 'Invalid PDF capability' });

    const result = await globalQuery(
      'SELECT id, email, name, role, status, org_id FROM users WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
      [userId, orgId],
    );
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });

    const user = result.rows[0];
    if (user.status !== 'active') return res.status(403).json({ error: 'Account is not active' });
    if (!['admin', 'super_admin'].includes(user.role)) {
      return res.status(403).json({ error: 'PDF access requires admin or super_admin role' });
    }

    req.user = user;
    attachOrgDb(req, res, next);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired PDF capability' });
  }
}

module.exports = { PDF_CAPABILITY_COOKIE, issuePublicationPdfCapability, authenticatePublicationPdfCapability };