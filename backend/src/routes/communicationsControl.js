const router = require('express').Router();
const crypto = require('crypto');
const { listCustomerPulseTargets, generateAndQueueScopedClientPulse } = require('../services/email/scopedClientPulse.service');
const { generateAndQueueSuperAdminClientPulse } = require('../services/email/clientPulseDispatch.service');
const { withOrg } = require('../utils/orgScopedDb');
const { assessManualPublicationRetry } = require('../utils/publicationManualRetryPolicy');
const { publicationForCountry } = require('../utils/intelligenceAgents');
const { renderAndStorePublicationPdf, getPublicationPdfAccessUrl, getPublicationPdfObject, streamPublicationPdf } = require('../services/intelligencePublicationPdf');
const { issuePublicationPdfCapability } = require('../middleware/publicationPdfCapability');

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
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='published')::int AS published, COUNT(*) FILTER (WHERE status='draft')::int AS drafts, COUNT(*) FILTER (WHERE status='review')::int AS review, COUNT(*) FILTER (WHERE status='published' AND pdf_status='ready')::int AS pdf_ready, COUNT(*) FILTER (WHERE status='published' AND pdf_status='failed')::int AS pdf_failed FROM intel_publications WHERE org_id=$1`,
      [req.user.org_id],
    ));
    issuePublicationPdfCapability(res, req.user);
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
          let pdfError = null;
          if (publicationId && created.publication_status === 'published') {
            try {
              pdf = await renderAndStorePublicationPdf(req.user.org_id, publicationId);
            } catch (pdfErr) {
              pdfError = String(pdfErr.message || pdfErr).slice(0, 1200);
            }
          }
          results.push({ country, type, publication: created, pdf, pdfError });
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

// Explicit analyst-facing alias: create or refresh the publication report on demand.
router.post('/publications/:id/generate-report', async (req, res, next) => {
  try {
    const result = await renderAndStorePublicationPdf(req.user.org_id, String(req.params.id));
    res.json({ data: result });
  } catch (err) { next(err); }
});

// Re-research one held/draft publication using its original, closed reporting period.
// This intentionally reuses the canonical publication pipeline and its advisory lock.
router.post('/publications/:id/retry-research', async (req, res, next) => {
  try {
    const lookup = await withOrg(req.user.org_id, c => c.query(
      'SELECT id,country_code,publication_type,status,period_end,body,version FROM intel_publications WHERE id=$1 AND org_id=$2',
      [String(req.params.id), req.user.org_id],
    ));
    if (!lookup.rows.length) return res.status(404).json({ error: 'Publication not found' });
    const publication = lookup.rows[0];
    const country = String(publication.country_code || '').toUpperCase();
    const type = String(publication.publication_type || '').toLowerCase();
    const periodEnd = new Date(publication.period_end);
    if (!['daily', 'weekly', 'monthly'].includes(type)) return res.status(409).json({
      error: 'publication_type_not_research_retriable',
      message: 'This publication type has no supported scheduled re-research workflow.',
    });
    if (!country || Number.isNaN(periodEnd.getTime()) || periodEnd.getTime() > Date.now()) return res.status(409).json({
      error: 'publication_period_invalid',
      message: 'A valid, closed reporting period and publication country are required; no retry was started.',
    });

    const now = new Date();
    const body = publication.body && typeof publication.body === 'object' && !Array.isArray(publication.body) ? publication.body : {};
    const priorResearch = body.deep_research && typeof body.deep_research === 'object' && !Array.isArray(body.deep_research) ? body.deep_research : {};
    const cooldown = assessManualPublicationRetry({ status: publication.status, deepResearch: priorResearch, now,
      cooldownMinutes: process.env.INTEL_PUBLICATION_RESEARCH_RETRY_MINUTES });
    if (!cooldown.allowed) {
      if (cooldown.retryAt) res.setHeader('Retry-After', String(Math.max(1, Math.ceil((Date.parse(cooldown.retryAt) - now.getTime()) / 1000))));
      return res.status(cooldown.statusCode).json({ error: cooldown.code, message: cooldown.message,
        ...(cooldown.retryAt ? { retry_at: cooldown.retryAt } : {}) });
    }

    // Optimistic claim blocks parallel clicks. Cooldown is persisted before provider work.
    const parsedVersion = Number(publication.version);
    const expectedVersion = Number.isSafeInteger(parsedVersion) && parsedVersion >= 0 ? parsedVersion : 0;
    const oldAttempts = Number(priorResearch.manual_retry_attempts);
    const manualAttempts = Number.isSafeInteger(oldAttempts) && oldAttempts >= 0 ? Math.min(2147483646, oldAttempts + 1) : 1;
    const attemptedAt = now.toISOString();
    const retryAt = new Date(now.getTime() + cooldown.cooldownMinutes * 60 * 1000).toISOString();
    const claim = await withOrg(req.user.org_id, c => c.query(
      `UPDATE intel_publications
          SET body=jsonb_set(COALESCE(body,'{}'::jsonb), '{deep_research}',
                COALESCE(body->'deep_research','{}'::jsonb) || jsonb_build_object(
                  'last_attempt_at',$4::text, 'next_attempt_at',$5::text, 'last_manual_retry_at',$4::text,
                  'manual_retry_attempts',$6::int, 'manual_retry_state','in_progress',
                  'manual_retry_failure_reason',NULL::text
                ), true),
              updated_at=NOW(), version=COALESCE(version,0)+1
        WHERE id=$1 AND org_id=$2 AND COALESCE(version,0)=$3 AND status IN ('draft','review')
        RETURNING id`,
      [publication.id, req.user.org_id, expectedVersion, attemptedAt, retryAt, manualAttempts],
    ));
    if (!claim.rows.length) return res.status(409).json({ error: 'publication_changed_before_retry',
      message: 'This publication changed while the retry was being prepared. Reload its current state before retrying.' });

    let recovered;
    try {
      recovered = await publicationForCountry(req.user.org_id, country, type, {
        periodAnchor: new Date(periodEnd.getTime() - 1000), forceResearch: true, recovery: true, manualRetry: true,
      });
    } catch (_error) {
      await withOrg(req.user.org_id, c => c.query(
        `UPDATE intel_publications
            SET body=jsonb_set(COALESCE(body,'{}'::jsonb), '{deep_research}',
                  COALESCE(body->'deep_research','{}'::jsonb) || jsonb_build_object(
                    'manual_retry_state','failed', 'manual_retry_completed_at',$3::text,
                    'manual_retry_failure_reason',$4::text, 'next_attempt_at',$5::text
                  ), true), updated_at=NOW(), version=COALESCE(version,0)+1
          WHERE id=$1 AND org_id=$2`,
        [publication.id, req.user.org_id, new Date().toISOString(),
          'Research provider failed before the attempt could complete; the retry cooldown remains active.', retryAt],
      ));
      return res.status(502).json({ error: 'publication_research_retry_failed',
        message: 'Research did not complete. The publication has not been marked ready and its retry cooldown remains active.',
        retry_at: retryAt });
    }

    const publicationId = recovered.publication_id || recovered.id || publication.id;
    const publicationStatus = String(recovered.publication_status || 'draft').toLowerCase();
    await withOrg(req.user.org_id, c => c.query(
      `UPDATE intel_publications
          SET body=jsonb_set(COALESCE(body,'{}'::jsonb), '{deep_research}',
                COALESCE(body->'deep_research','{}'::jsonb) || jsonb_build_object(
                  'manual_retry_state','completed', 'manual_retry_completed_at',$3::text,
                  'manual_retry_outcome',$4::text, 'manual_retry_failure_reason',NULL::text
                ), true), updated_at=NOW(), version=COALESCE(version,0)+1
        WHERE id=$1 AND org_id=$2`,
      [publicationId, req.user.org_id, new Date().toISOString(), publicationStatus],
    ));

    let pdf = null;
    let pdfError = null;
    if (publicationId && publicationStatus === 'published') {
      try { pdf = await renderAndStorePublicationPdf(req.user.org_id, publicationId); }
      catch (error) { pdfError = String(error?.message || error).slice(0, 1200); }
    }
    return res.status(202).json({ data: {
      publication_id: publicationId, country, type, publication_status: publicationStatus,
      recovery_status: recovered.status || 'completed',
      research_retry: { requested: true, forceResearch: true, reporting_period_end: periodEnd.toISOString(),
        cooldown_minutes: cooldown.cooldownMinutes, retry_at: retryAt, attempt: manualAttempts },
      pdf, pdfError,
    } });
  } catch (err) { next(err); }
});
router.get('/publications/:id/pdf', async (req, res, next) => {
  try {
    await streamPublicationPdf(req.user.org_id, String(req.params.id), req, res);
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
