/**
 * Sonalit Mission Control — the platform control plane API.
 *
 * Every route here requires PLATFORM scope, which is established server-side
 * from the platform_admins table. There is no request field, header or token
 * claim that can grant it, so this surface is unreachable from a customer
 * session however the client is modified.
 *
 * Reads go through withPlatform(), which sets app.platform_scope — the
 * predicate the control-plane RLS policies key on. Tenant *operational* data is
 * deliberately not readable from here: to look inside a customer account an
 * operator opens a support session, which scopes them into that tenant with its
 * own RLS in force.
 */
const router = require('express').Router();
const Joi = require('joi');
const { authenticate } = require('../middleware/auth');
const { attachSecurityContext, requireScope, requirePermission } = require('../security/guards');
const { withPlatform } = require('../utils/orgScopedDb');
const { ACTIONS, recordSecurityEvent } = require('../security/events');
const supportMode = require('../services/supportMode');
const logger = require('../utils/logger');

router.use(authenticate, attachSecurityContext(), requireScope('PLATFORM'));

const uuid = Joi.string().uuid({ version: 'uuidv4' });

// ── Tenants ───────────────────────────────────────────────────────────────────

router.get('/tenants', async (req, res, next) => {
  try {
    const { status, classification } = req.query;
    const rows = await withPlatform(async (client) => {
      const result = await client.query(
        `SELECT id, name, legal_name, slug, status, data_classification,
                subscription_plan, subscription_status, enabled_modules,
                created_at, updated_at
           FROM tenants
          WHERE ($1::text IS NULL OR status = $1)
            AND ($2::text IS NULL OR data_classification = $2)
          ORDER BY created_at DESC
          LIMIT 200`,
        [status || null, classification || null]
      );
      return result.rows;
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

const createTenantSchema = Joi.object({
  name: Joi.string().trim().min(2).max(255).required(),
  legal_name: Joi.string().trim().max(255).allow(null, ''),
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9][a-z0-9-]{1,118}$/).required(),
  subscription_plan: Joi.string().trim().max(64).allow(null, ''),
  enabled_modules: Joi.array().items(Joi.string().valid(
    'FLEET', 'CONVOY', 'GPS', 'ALERTS', 'REPORTING', 'CDS',
    'E_LOCK', 'GEOFENCING', 'ANALYTICS', 'API'
  )).default(['FLEET', 'CONVOY', 'GPS', 'ALERTS', 'REPORTING']),
});

router.post('/tenants', requirePermission('organization.manage'), async (req, res, next) => {
  try {
    const { error, value } = createTenantSchema.validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.details[0].message });

    // New tenants start PENDING. Activation is a separate, deliberate step, so
    // a half-provisioned account never serves traffic.
    const tenant = await withPlatform(async (client) => {
      const result = await client.query(
        `INSERT INTO tenants (name, legal_name, slug, status, data_classification,
                              subscription_plan, enabled_modules)
         VALUES ($1, $2, $3, 'PENDING', 'TENANT', $4, $5)
         RETURNING id, name, slug, status, enabled_modules, created_at`,
        [
          value.name,
          value.legal_name || null,
          value.slug,
          value.subscription_plan || null,
          value.enabled_modules,
        ]
      );
      return result.rows[0];
    });

    await recordSecurityEvent({
      action: ACTIONS.TENANT_CREATED,
      result: 'SUCCESS',
      context: req.security,
      req,
      tenantId: tenant.id,
      resourceType: 'tenant',
      resourceId: tenant.id,
      metadata: { name: tenant.name, slug: tenant.slug },
    });

    res.status(201).json({ data: tenant });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'slug_taken' });
    next(err);
  }
});

const statusSchema = Joi.object({
  status: Joi.string().valid('PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'ARCHIVED').required(),
  reason: Joi.string().trim().max(1000).allow(null, ''),
});

/**
 * Change a tenant's lifecycle status. Suspension takes effect on the next
 * request: requireActiveTenant reads the status through the security context,
 * so a suspended tenant loses API access, not just its dashboard.
 */
router.patch('/tenants/:id/status', requirePermission('organization.manage'), async (req, res, next) => {
  try {
    const { error: idError } = uuid.validate(req.params.id);
    if (idError) return res.status(400).json({ error: 'invalid_tenant_id' });

    const { error, value } = statusSchema.validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const updated = await withPlatform(async (client) => {
      const result = await client.query(
        `UPDATE tenants
            SET status = $2,
                updated_at = NOW(),
                archived_at = CASE WHEN $2 = 'ARCHIVED' THEN NOW() ELSE archived_at END
          WHERE id = $1
          RETURNING id, name, status`,
        [req.params.id, value.status]
      );
      return result.rows[0] || null;
    });

    if (!updated) return res.status(404).json({ error: 'not_found' });

    await recordSecurityEvent({
      action: value.status === 'ACTIVE' ? ACTIONS.TENANT_REACTIVATED : ACTIONS.TENANT_SUSPENDED,
      result: 'SUCCESS',
      context: req.security,
      req,
      tenantId: updated.id,
      resourceType: 'tenant',
      resourceId: updated.id,
      metadata: { status: value.status, reason: value.reason || null },
    });

    res.json({ data: updated });
  } catch (err) { next(err); }
});

const modulesSchema = Joi.object({
  enabled_modules: Joi.array().items(Joi.string().valid(
    'FLEET', 'CONVOY', 'GPS', 'ALERTS', 'REPORTING', 'CDS',
    'E_LOCK', 'GEOFENCING', 'ANALYTICS', 'API'
  )).required(),
});

/**
 * Module entitlements. These are resolved into the permission list on every
 * request, so a module removed here stops granting its permissions on the next
 * call — there is no entitlement cache to go stale.
 */
router.patch('/tenants/:id/modules', requirePermission('organization.manage'), async (req, res, next) => {
  try {
    const { error: idError } = uuid.validate(req.params.id);
    if (idError) return res.status(400).json({ error: 'invalid_tenant_id' });

    const { error, value } = modulesSchema.validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const updated = await withPlatform(async (client) => {
      const result = await client.query(
        `UPDATE tenants SET enabled_modules = $2, updated_at = NOW()
          WHERE id = $1 RETURNING id, name, enabled_modules`,
        [req.params.id, value.enabled_modules]
      );
      return result.rows[0] || null;
    });

    if (!updated) return res.status(404).json({ error: 'not_found' });

    await recordSecurityEvent({
      action: ACTIONS.PERMISSION_CHANGED,
      result: 'SUCCESS',
      context: req.security,
      req,
      tenantId: updated.id,
      resourceType: 'tenant_modules',
      resourceId: updated.id,
      metadata: { enabled_modules: updated.enabled_modules },
    });

    res.json({ data: updated });
  } catch (err) { next(err); }
});

// ── Customer access requests ──────────────────────────────────────────────────

router.get('/access-requests', async (req, res, next) => {
  try {
    const status = req.query.status || 'PENDING';
    const rows = await withPlatform(async (client) => {
      const result = await client.query(
        `SELECT id, company_name, contact_name, contact_email, contact_phone,
                country, fleet_size, message, status, internal_notes,
                reviewed_by, reviewed_at, tenant_id, created_at
           FROM tenant_access_requests
          WHERE status = $1
          ORDER BY created_at DESC
          LIMIT 200`,
        [status]
      );
      return result.rows;
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

const reviewSchema = Joi.object({
  decision: Joi.string().valid('APPROVED', 'REJECTED').required(),
  internal_notes: Joi.string().trim().max(4000).allow(null, ''),
  tenant_id: uuid.allow(null),
});

router.post('/access-requests/:id/review', requirePermission('organization.manage'), async (req, res, next) => {
  try {
    const { error: idError } = uuid.validate(req.params.id);
    if (idError) return res.status(400).json({ error: 'invalid_request_id' });

    const { error, value } = reviewSchema.validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const reviewed = await withPlatform(async (client) => {
      const result = await client.query(
        `UPDATE tenant_access_requests
            SET status = $2, internal_notes = COALESCE($3, internal_notes),
                reviewed_by = $4, reviewed_at = NOW(), tenant_id = $5, updated_at = NOW()
          WHERE id = $1 AND status = 'PENDING'
          RETURNING id, company_name, status, tenant_id`,
        [req.params.id, value.decision, value.internal_notes || null, req.security.userId, value.tenant_id || null]
      );
      return result.rows[0] || null;
    });

    if (!reviewed) return res.status(404).json({ error: 'not_found' });

    await recordSecurityEvent({
      action: value.decision === 'APPROVED'
        ? ACTIONS.CUSTOMER_REQUEST_APPROVED
        : ACTIONS.CUSTOMER_REQUEST_REJECTED,
      result: 'SUCCESS',
      context: req.security,
      req,
      tenantId: reviewed.tenant_id,
      resourceType: 'tenant_access_request',
      resourceId: reviewed.id,
      metadata: { company: reviewed.company_name },
    });

    res.json({ data: reviewed });
  } catch (err) { next(err); }
});

// ── Support mode ──────────────────────────────────────────────────────────────

const supportSchema = Joi.object({
  tenant_id: uuid.required(),
  reason: Joi.string().trim().min(10).max(1000).required(),
  access_level: Joi.string().valid('READ_ONLY', 'READ_WRITE').default('READ_ONLY'),
  duration_minutes: Joi.number().integer().min(1).max(supportMode.MAX_DURATION_MINUTES)
    .default(supportMode.DEFAULT_DURATION_MINUTES),
});

router.post('/support-sessions', async (req, res, next) => {
  try {
    const { error, value } = supportSchema.validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const session = await supportMode.startSupportSession({
      context: req.security,
      tenantId: value.tenant_id,
      reason: value.reason,
      accessLevel: value.access_level,
      durationMinutes: value.duration_minutes,
      req,
    });

    res.status(201).json({ data: session });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/support-sessions', async (req, res, next) => {
  try {
    res.json({ data: await supportMode.listActiveSessions(req.security.userId) });
  } catch (err) { next(err); }
});

router.delete('/support-sessions/:id', async (req, res, next) => {
  try {
    const { error } = uuid.validate(req.params.id);
    if (error) return res.status(400).json({ error: 'invalid_session_id' });

    const ended = await supportMode.endSupportSession({
      context: req.security,
      sessionId: req.params.id,
      req,
    });
    if (!ended) return res.status(404).json({ error: 'not_found' });
    res.json({ data: ended });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── Security stream ───────────────────────────────────────────────────────────

router.get('/security-events', async (req, res, next) => {
  try {
    const { tenant_id: tenantId, result: outcome, action } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const rows = await withPlatform(async (client) => {
      const found = await client.query(
        `SELECT event_id, occurred_at, action, result, scope, actor_id, tenant_id,
                resource_type, resource_id, request_id, source_ip, metadata
           FROM security_events
          WHERE ($1::uuid IS NULL OR tenant_id = $1)
            AND ($2::text IS NULL OR result = $2)
            AND ($3::text IS NULL OR action = $3)
          ORDER BY occurred_at DESC
          LIMIT $4`,
        [tenantId || null, outcome || null, action || null, limit]
      );
      return found.rows;
    });

    res.json({ data: rows });
  } catch (err) { next(err); }
});

/** Platform overview counters for the Mission Control landing view. */
router.get('/overview', async (req, res, next) => {
  try {
    const overview = await withPlatform(async (client) => {
      const tenants = await client.query(
        `SELECT status, count(*)::int AS count FROM tenants GROUP BY status`
      );
      const requests = await client.query(
        `SELECT count(*)::int AS pending FROM tenant_access_requests WHERE status = 'PENDING'`
      );
      const denials = await client.query(
        `SELECT count(*)::int AS denials FROM security_events
          WHERE result = 'DENIED' AND occurred_at > NOW() - INTERVAL '24 hours'`
      );
      const support = await client.query(
        `SELECT count(*)::int AS active FROM support_sessions
          WHERE ended_at IS NULL AND expires_at > NOW()`
      );
      return {
        tenants_by_status: tenants.rows,
        pending_access_requests: requests.rows[0].pending,
        denials_24h: denials.rows[0].denials,
        active_support_sessions: support.rows[0].active,
      };
    });
    res.json({ data: overview });
  } catch (err) { next(err); }
});

logger.info('Mission Control routes initialised');

module.exports = router;
