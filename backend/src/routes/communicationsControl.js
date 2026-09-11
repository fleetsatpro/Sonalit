const router = require('express').Router();
const crypto = require('crypto');
const { listCustomerPulseTargets, generateAndQueueScopedClientPulse } = require('../services/email/scopedClientPulse.service');
const { generateAndQueueSuperAdminClientPulse } = require('../services/email/clientPulseDispatch.service');
const { withOrg } = require('../utils/orgScopedDb');
const { publicationForCountry } = require('../utils/intelligenceAgents');
const { renderAndStorePublicationPdf, getPublicationPdfAccessUrl } = require('../services/intelligencePublicationPdf');

// Mounted below /admin, whose parent router already enforces admin/super_admin.
router.get('/health', async (req, res, next) => {
  try {
    const [queued, delivery, recipients] = await Promise.all([
      withOrg(req.user.org_id, c => c.query(`SELECT COUNT(*)::int AS n FROM email_notifications WHERE org_id=$1 AND status='queued' AND created_at > NOW()-INTERVAL '24 hours'`, [req.user.org_id])),
      withOrg(req.user.org_id, c => c.query(`SELECT status, COUNT(*)::int AS n FROM communication_delivery_events WHERE org_id=$1 AND created_at > NOW()-INTERVAL '24 hours' GROUP BY status ORDER BY status`, [req.user.org_id])),
      withOrg(req.user.org_id, c => c.query(`SELECT COUNT(*)::int AS n FROM client_email_recipients WHERE org_id=$1 AND enabled=true AND deleted_at IS NULL`, [req.user.org_id])),
    ]);
    res.json({ data: { status: 'operational', queued_24h: queued.rows[0].n, recipients: recipients.rows[0].n, delivery_24h: Object.fromEntries(delivery.rows.map(r => [r.status, r.n])), checkedAt: new Date().toISOString() } });
  } catch (err) { next(err); }
});

router.get('/deliveries', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const rows = await withOrg(req.user.org_id, c => c.query(
      `SELECT e.id,e.event_type,e.channel,e.status,e.provider_message_id,e.provider_event_id,e.correlation_id,e.error_code,e.error_message,e.created_at,e.sent_at,e.delivered_at,e.failed_at,
              n.recipient,
              COALESCE(NULLIF(n.recipient_name,''), NULLIF(r.name,''), CASE WHEN r.authority_role='super_admin' THEN 'Super Admin' WHEN r.authority_role='admin' THEN 'Admin' ELSE NULL END) AS recipient_name,
              COALESCE(r.authority_role, CASE WHEN lower(COALESCE(n.recipient_name,''))='super admin' THEN 'super_admin' END) AS recipient_role,
              n.notification_type,n.subject
         FROM communication_delivery_events e
         LEFT JOIN email_notifications n ON n.org_id=e.org_id AND n.provider_email_id=e.provider_message_id
         LEFT JOIN client_email_recipients r ON r.org_id=e.org_id AND lower(trim(r.email))=lower(trim(n.recipient)) AND r.deleted_at IS NULL
        WHERE e.org_id=$1 ORDER BY e.created_at DESC LIMIT $2`, [req.user.org_id, limit]
    ));
    res.json({ data: rows.rows });
  } catch (err) { next(err); }
});

router.get('/publications', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const values = [req.user.org_id];
    const filters = ['org_id=$1'];
    if (req.query.country) { values.push(String(req.query.country).toUpperCase()); filters.push(`country_code=$${values.length}`); }
    if (req.query.type) { values.push(String(req.query.type)); filters.push(`publication_type=$${values.length}`); }
    if (req.query.status) { values.push(String(req.query.status)); filters.push(`status=$${values.length}`); }
    values.push(limit);
    const rows = await withOrg(req.user.org_id, c => c.query(
      `SELECT id,country_code,publication_type,title,subtitle,status,period_start,period_end,executive_assessment,confidence,version,published_at,created_at,updated_at,pdf_status,pdf_url,pdf_generated_at,pdf_error
         FROM intel_publications WHERE ${filters.join(' AND ')} ORDER BY period_end DESC NULLS LAST,created_at DESC LIMIT $${values.length}`,
      values,
    ));
    const counts = await withOrg(req.user.org_id, c => c.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='published')::int AS published, COUNT(*) FILTER (WHERE status='published' AND pdf_status='ready')::int AS pdf_ready, COUNT(*) FILTER (WHERE status='published' AND pdf_status='failed')::int AS pdf_failed FROM intel_publications WHERE org_id=$1`,
      [req.user.org_id],
    ));
    res.json({ data: { publications: rows.rows, summary: counts.rows[0] } });
  } catch (err) { next(err); }
});

router.post('/publications/generate', async (req, res, next) => {
  try {
    const types = Array.isArray(req.body?.types) && req.body.types.length ? [...new Set(req.body.types.map(String))] : ['daily'];
    const countries = Array.isArray(req.body?.countries) && req.body.countries.length ? [...new Set(req.body.countries.map(x => String(x).toUpperCase()))] : String(process.env.INTEL_PUBLICATION_COUNTRIES || 'KE,SO,ET,UG,TZ,RW,BI,SS,DJ,ER,SD,CD').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
    const results = [];
    for (const type of types) {
      if (!['daily','weekly','monthly'].includes(type)) continue;
      for (const country of countries) {
        try {
          const created = await publicationForCountry(req.user.org_id, country, type);
          const publicationId = created.publication_id || created.id;
          let pdf = null;
          if (publicationId) pdf = await renderAndStorePublicationPdf(req.user.org_id, publicationId);
          results.push({ country, type, publication: created, pdf });
        } catch (err) {
          results.push({ country, type, status: 'failed', error: String(err.message || err).slice(0, 1200) });
        }
      }
    }
    res.status(202).json({ data: { jobId: crypto.randomUUID(), requested: { countries, types }, results } });
  } catch (err) { next(err); }
});

router.post('/publications/:id/render', async (req, res, next) => {
  try {
    const result = await renderAndStorePublicationPdf(req.user.org_id, String(req.params.id));
    res.json({ data: result });
  } catch (err) { next(err); }
});

router.get('/publications/:id/pdf', async (req, res, next) => {
  try {
    const url = await getPublicationPdfAccessUrl(req.user.org_id, String(req.params.id));
    res.redirect(302, url);
  } catch (err) { next(err); }
});

router.post('/client-pulse/dispatch', async (req, res, next) => {
  try {
    const snapshotAt = new Date();
    const global = await generateAndQueueSuperAdminClientPulse(req.user.org_id, { snapshotAt, reason: 'manual' });
    const targets = await listCustomerPulseTargets(req.user.org_id);
    const requested = Array.isArray(req.body?.customerIds) && req.body.customerIds.length
      ? [...new Set(req.body.customerIds.map(String))]
      : targets;
    const invalid = requested.filter(id => !targets.includes(id));
    if (invalid.length) return res.status(403).json({ error: 'customer_scope_violation', invalidCustomerIds: invalid });

    const windowStart = new Date(Math.floor(snapshotAt.getTime() / 300000) * 300000);
    const customers = [];
    for (const customerId of requested) {
      try {
        customers.push(await generateAndQueueScopedClientPulse(req.user.org_id, customerId, {
          snapshotAt,
          reason: 'manual_canonical',
          idempotencyKey: `manual-cds-client-pulse:${customerId}:${windowStart.toISOString()}`,
        }));
      } catch (err) {
        customers.push({ customerId, skipped: true, reason: 'delivery_failed', error: String(err.message || err).slice(0, 1000) });
      }
    }
    const queued = Number(global?.queued ?? 0) + customers.reduce((sum, item) => sum + Number(item?.queued ?? 0), 0);
    res.json({ data: { dispatchId: crypto.randomUUID(), snapshotAt: snapshotAt.toISOString(), queued, global, customers, requested: requested.length } });
  } catch (err) { next(err); }
});

module.exports = router;
