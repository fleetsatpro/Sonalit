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
  if (body.domain === 'cds' && !body.cds_customer_id) return { error: '"cds_customer_id" is required for CDS enrollment' };
  if (body.domain !== 'cds' && body.cds_customer_id != null) return { error: '"cds_customer_id" is only valid for CDS enrollment' };
  return null;
}

router.get('/recipients', async (req, res, next) => {
  try {
    const result = await withOrg(req.user.org_id, c => c.query(`
      SELECT r.id, r.email, r.name, r.company, r.enabled, r.authority_role, r.client_id,
             COALESCE(json_agg(json_build_object(
               'id', e.id, 'domain', e.domain, 'client_id', e.client_id,
               'cds_customer_id', e.cds_customer_id, 'contact_role', e.contact_role,
               'locale', e.locale, 'timezone', e.timezone, 'status', e.status,
               'subscriptions', COALESCE((SELECT json_agg(json_build_object(
                 'id', s.id, 'event_type', s.event_type, 'channel', s.channel,
                 'enabled', s.enabled, 'delivery_mode', s.delivery_mode,
                 'critical_override', s.critical_override
               ) ORDER BY s.event_type, s.channel) FROM communication_subscriptions s WHERE s.enrollment_id=e.id), '[]'::json)
             ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]'::json) AS enrollments
        FROM client_email_recipients r
        LEFT JOIN communication_enrollments e ON e.org_id=r.org_id AND e.recipient_id=r.id
       WHERE r.org_id=$1 AND r.deleted_at IS NULL
       GROUP BY r.id
       ORDER BY lower(COALESCE(r.name, r.email)), lower(r.email)`, [req.user.org_id]));
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.get('/customers', async (req, res, next) => {
  try {
    const result = await withOrg(req.user.org_id, c => c.query(`
      SELECT id, code, company_name, contact_person, email, phone, status
        FROM cds_customers
       WHERE org_id=$1 AND deleted_at IS NULL
       ORDER BY lower(company_name), lower(COALESCE(contact_person,''))`, [req.user.org_id]));
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.post('/recipients', async (req, res, next) => {
  try {
    const { email, name = null, company = null, enabled = true } = req.body || {};
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'email is required' });
    const result = await withOrg(req.user.org_id, c => c.query(`
      INSERT INTO client_email_recipients (org_id, email, name, company, enabled)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (org_id, email) DO UPDATE SET
        name=EXCLUDED.name,
        company=EXCLUDED.company,
        enabled=EXCLUDED.enabled,
        updated_at=NOW(),
        deleted_at=NULL
      RETURNING id, org_id, email, name, company, enabled, client_id, authority_role`,
      [req.user.org_id, String(email).trim().toLowerCase(), name, company, enabled !== false]));
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.post('/enrollments', async (req, res, next) => {
  try {
    const error = validateEnrollment(req.body);
    if (error) return res.status(400).json({ error: error.error, details: error.error });
    const { recipient_id, domain, client_id = null, cds_customer_id = null, contact_role = null, locale = null, timezone = null, status = 'pending_verification' } = req.body;

    const result = await withOrg(req.user.org_id, async c => {
      const recipient = await c.query(`SELECT id FROM client_email_recipients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [recipient_id, req.user.org_id]);
      if (!recipient.rows.length) { const e = new Error('recipient_not_found'); e.status = 404; throw e; }
      if (client_id) {
        const client = await c.query(`SELECT id FROM cargo_clients WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [client_id, req.user.org_id]);
        if (!client.rows.length) { const e = new Error('client_not_found'); e.status = 404; throw e; }
      }
      if (cds_customer_id) {
        const customer = await c.query(`SELECT id FROM cds_customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [cds_customer_id, req.user.org_id]);
        if (!customer.rows.length) { const e = new Error('cds_customer_not_found'); e.status = 404; throw e; }
      }
      const existing = await c.query(`SELECT id FROM communication_enrollments WHERE org_id=$1 AND recipient_id=$2 AND domain=$3 AND COALESCE(cds_customer_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`, [req.user.org_id, recipient_id, domain, cds_customer_id]);
      if (existing.rows.length) {
        const updated = await c.query(`UPDATE communication_enrollments SET client_id=$2, contact_role=$3, locale=$4, timezone=$5, status=$6, updated_at=NOW() WHERE id=$1 RETURNING *`, [existing.rows[0].id, client_id, contact_role, locale, timezone, status]);
        if (client_id) await c.query(`UPDATE client_email_recipients SET client_id=$2, updated_at=NOW() WHERE id=$1 AND org_id=$3`, [recipient_id, client_id, req.user.org_id]);
        return updated;
      }
      const inserted = await c.query(`INSERT INTO communication_enrollments (org_id, recipient_id, domain, client_id, cds_customer_id, contact_role, locale, timezone, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [req.user.org_id, recipient_id, domain, client_id, cds_customer_id, contact_role, locale, timezone, status]);
      if (client_id) await c.query(`UPDATE client_email_recipients SET client_id=$2, updated_at=NOW() WHERE id=$1 AND org_id=$3`, [recipient_id, client_id, req.user.org_id]);
      return inserted;
    });
    res.status(201).json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.get('/enrollments', async (req, res, next) => {
  try {
    const result = await withOrg(req.user.org_id, c => c.query(`SELECT * FROM communication_enrollments WHERE org_id=$1 ORDER BY created_at DESC`, [req.user.org_id]));
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

router.patch('/enrollments/:id', async (req, res, next) => {
  try {
    const allowed = new Set(['draft','pending_verification','verified','active','suspended','revoked']);
    if (!allowed.has(req.body?.status)) return res.status(400).json({ error: 'invalid enrollment status' });
    const result = await withOrg(req.user.org_id, c => c.query(`UPDATE communication_enrollments SET status=$2, updated_at=NOW() WHERE id=$1 AND org_id=$3 RETURNING *`, [req.params.id, req.body.status, req.user.org_id]));
    if (!result.rows.length) return res.status(404).json({ error: 'enrollment_not_found' });
    res.json({ data: result.rows[0] });
  } catch (err) { next(err); }
});

router.put('/enrollments/:id/subscriptions', async (req, res, next) => {
  try {
    const subscriptions = Array.isArray(req.body?.subscriptions) ? req.body.subscriptions : [];
    const validChannels = new Set(['email','sms','whatsapp','portal','web']);
    const validModes = new Set(['immediate','digest','batched']);
    const result = await withOrg(req.user.org_id, async c => {
      const enrollment = await c.query(`SELECT id FROM communication_enrollments WHERE id=$1 AND org_id=$2`, [req.params.id, req.user.org_id]);
      if (!enrollment.rows.length) { const e = new Error('enrollment_not_found'); e.status = 404; throw e; }
      for (const sub of subscriptions) {
        if (!sub?.event_type || !validChannels.has(sub.channel || 'email') || !validModes.has(sub.delivery_mode || 'immediate')) {
          const e = new Error('invalid subscription payload'); e.status = 400; throw e;
        }
        await c.query(`INSERT INTO communication_subscriptions (org_id, enrollment_id, event_type, channel, delivery_mode, enabled, critical_override) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (enrollment_id,event_type,channel) DO UPDATE SET delivery_mode=EXCLUDED.delivery_mode, enabled=EXCLUDED.enabled, critical_override=EXCLUDED.critical_override, updated_at=NOW()`, [req.user.org_id, req.params.id, String(sub.event_type), sub.channel || 'email', sub.delivery_mode || 'immediate', sub.enabled !== false, sub.critical_override !== false]);
      }
      return c.query(`SELECT * FROM communication_subscriptions WHERE enrollment_id=$1 ORDER BY event_type, channel`, [req.params.id]);
    });
    res.json({ data: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
