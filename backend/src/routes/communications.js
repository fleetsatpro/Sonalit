const router = require('express').Router();
const { withOrg } = require('../utils/orgScopedDb');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateEnrollment(body) {
  const allowed = new Set(['recipient_id','domain','client_id','cds_customer_id','contact_role','locale','timezone','status']);
  const unknown = Object.keys(body || {}).filter(k => !allowed.has(k));
  if (unknown.length) return { error: `"${unknown[0]}" is not allowed` };
  for (const key of ['recipient_id','client_id','cds_customer_id']) {
    if (body[key] != null && !UUID_RE.test(String(body[key]))) return { error: `"${key}" must be a valid UUID` };
  }
  if (!body.recipient_id) return { error: '"recipient_id" is required' };
  if (!body.domain) return { error: '"domain" is required' };
  if (!['platform','fleet','cds'].includes(body.domain)) return { error: '"domain" must be one of [platform, fleet, cds]' };
  return null;
}

router.post('/enrollments', async (req, res, next) => {
  try {
    const error = validateEnrollment(req.body);
    if (error) return res.status(400).json({ error: error.error, details: error.error });
    const { recipient_id, domain, client_id = null, cds_customer_id = null, contact_role = null, locale = null, timezone = null, status = 'pending_verification' } = req.body;
    const result = await withOrg(req.user.org_id, c => c.query(
      `INSERT INTO communication_enrollments (org_id, recipient_id, domain, client_id, cds_customer_id, contact_role, locale, timezone, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.org_id, recipient_id, domain, client_id, cds_customer_id, contact_role, locale, timezone, status]
    ));
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.get('/enrollments', async (req, res, next) => {
  try {
    const result = await withOrg(req.user.org_id, c => c.query(`SELECT * FROM communication_enrollments WHERE org_id=$1 ORDER BY created_at DESC`, [req.user.org_id]));
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
