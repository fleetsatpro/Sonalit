const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');

const router = express.Router();
router.use(authenticate);

// The legacy monolith remains the production /api/v1 compatibility surface.
// Keep it feature-complete with the v4 Rules contract until the gateway cutover.
function db(req) { return req.db || query; }
function orgId(req) { return req.user?.org_id || null; }

function normalizeConditions(input) {
  if (Array.isArray(input.conditions) && input.conditions.length) return input.conditions;
  if (input.condition_type || input.condition) {
    const field = input.condition_type === 'speed' ? 'speed_kmh' : (input.condition_type || input.condition);
    const operator = input.condition_type === 'idle' ? 'lte' : 'gt';
    return [{ field, operator, value: input.threshold ?? 0 }];
  }
  return [];
}

function normalizeActions(input) {
  if (Array.isArray(input.actions) && input.actions.length) return input.actions;
  return [{ type: input.action_type || input.action || 'alert' }];
}

function compare(operator, actual, expected) {
  switch (operator) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt': return Number(actual) > Number(expected);
    case 'gte': return Number(actual) >= Number(expected);
    case 'lt': return Number(actual) < Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'not_in': return Array.isArray(expected) && !expected.includes(actual);
    case 'contains': return typeof actual === 'string' && actual.includes(String(expected));
    case 'exists': return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null;
    case 'between': return Array.isArray(expected) && Number(actual) >= Number(expected[0]) && Number(actual) <= Number(expected[1]);
    case 'trigger': return true;
    default: return false;
  }
}

function evaluateRule(row, event) {
  const data = event?.data || {};
  const conditions = Array.isArray(row.conditions) ? row.conditions : [];
  const logic = row.condition_logic === 'any' ? 'any' : 'all';
  const trace = conditions.map((condition) => {
    const actual = condition.field === 'event.type' ? event?.type : data[condition.field];
    const matchedBase = compare(condition.operator, actual, condition.value);
    const matched = condition.negate ? !matchedBase : matchedBase;
    return { field: condition.field, operator: condition.operator, expected: condition.value, actual, matched };
  });
  const matched = logic === 'any' ? trace.some((x) => x.matched) : trace.every((x) => x.matched);
  return {
    matched,
    mode: row.mode || 'live',
    condition_trace: trace,
    action_results: matched ? (Array.isArray(row.actions) ? row.actions.map((a, i) => ({ index: i, type: a.type, status: 'would_execute' })) : []) : [],
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const result = await db(req)(
    `SELECT * FROM rules
      WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR org_id=$1)
      ORDER BY priority DESC, created_at DESC`,
    [orgId(req)],
  );
  res.json({ data: result.rows });
}));

router.get('/stats', asyncHandler(async (req, res) => {
  const result = await db(req)(
    `SELECT
       COUNT(*) FILTER (WHERE deleted_at IS NULL) AS total,
       COUNT(*) FILTER (WHERE deleted_at IS NULL AND enabled=true AND status='active') AS active,
       COUNT(*) FILTER (WHERE deleted_at IS NULL AND mode='dry_run') AS dry_run,
       COALESCE(SUM(trigger_count) FILTER (WHERE deleted_at IS NULL),0) AS executions,
       COALESCE(SUM(failure_count) FILTER (WHERE deleted_at IS NULL),0) AS failures,
       MAX(last_triggered_at) AS last_triggered_at
     FROM rules
     WHERE ($1::uuid IS NULL OR org_id=$1)`,
    [orgId(req)],
  );
  res.json({ data: result.rows[0] || {} });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const result = await db(req)(
    `SELECT * FROM rules WHERE id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR org_id=$2)`,
    [req.params.id, orgId(req)],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Rule not found' });
  res.json(result.rows[0]);
}));

router.get('/:id/executions', asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const result = await db(req)(
    `SELECT id, rule_id, rule_version, correlation_id, subject_type, subject_id,
            event_type, event_id, mode, matched, suppressed, suppression_reason,
            decision_ms, condition_trace, action_results, error, evaluated_at
       FROM rule_executions
      WHERE rule_id=$1 AND ($2::uuid IS NULL OR org_id=$2)
      ORDER BY evaluated_at DESC LIMIT $3`,
    [req.params.id, orgId(req), limit],
  );
  res.json({ data: result.rows });
}));

router.post('/', authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const input = req.body || {};
  if (!input.name) return res.status(400).json({ error: 'Name is required' });
  const conditions = normalizeConditions(input);
  const actions = normalizeActions(input);
  if (!conditions.length || !actions.length) return res.status(400).json({ error: 'A rule needs at least one condition and one action' });

  const id = crypto.randomUUID();
  const result = await db(req)(
    `INSERT INTO rules (
       id, org_id, name, description, condition, action, condition_type, threshold, action_type,
       enabled, status, priority, severity, mode, scope, conditions, actions, condition_logic,
       schedule, cooldown_seconds, evaluation_window_seconds, deduplication, tags,
       version, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,
       $19::jsonb,$20,$21,$22::jsonb,$23::jsonb,1,$24,$24
     ) RETURNING *`,
    [
      id, orgId(req), input.name, input.description || null,
      input.condition || input.condition_type || null,
      input.action || input.action_type || null,
      input.condition_type || null, input.threshold ?? null, input.action_type || null,
      input.enabled !== false,
      input.status || (input.enabled === false ? 'paused' : 'active'),
      Number.isFinite(Number(input.priority)) ? Number(input.priority) : 50,
      input.severity || 'medium', input.mode || 'live',
      JSON.stringify(input.scope || { type: 'org' }), JSON.stringify(conditions), JSON.stringify(actions),
      input.condition_logic || 'all', JSON.stringify(input.schedule || { enabled: false }),
      Number.isFinite(Number(input.cooldown_seconds)) ? Number(input.cooldown_seconds) : 900,
      Number.isFinite(Number(input.evaluation_window_seconds)) ? Number(input.evaluation_window_seconds) : 0,
      JSON.stringify(input.deduplication || { strategy: 'rule_subject', ttl_seconds: 900 }),
      JSON.stringify(Array.isArray(input.tags) ? input.tags : []), req.user.id,
    ],
  );

  await db(req)(
    `INSERT INTO rule_versions (rule_id, org_id, version, snapshot, change_type, changed_by)
     VALUES ($1,$2,1,$3::jsonb,'create',$4)`,
    [id, orgId(req), JSON.stringify(result.rows[0]), req.user.id],
  );
  res.status(201).json({ data: result.rows[0] });
}));

router.post('/:id/test', authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const result = await db(req)(
    `SELECT * FROM rules WHERE id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR org_id=$2)`,
    [req.params.id, orgId(req)],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Rule not found' });
  const body = req.body || {};
  res.json({ data: evaluateRule(result.rows[0], { type: body.type || 'rules.test', data: body.data || {}, subject_type: body.subject_type, subject_id: body.subject_id }) });
}));

router.patch('/:id', authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const existing = await db(req)(
    `SELECT * FROM rules WHERE id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR org_id=$2)`,
    [req.params.id, orgId(req)],
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Rule not found' });
  const base = existing.rows[0];
  const input = req.body || {};
  const merged = { ...base, ...input };
  const conditions = input.conditions || base.conditions || normalizeConditions(merged);
  const actions = input.actions || base.actions || normalizeActions(merged);
  const nextVersion = Number(base.version || 1) + 1;
  const enabled = input.enabled === undefined ? base.enabled : Boolean(input.enabled);
  const status = input.status || (input.enabled === undefined ? base.status : (enabled ? 'active' : 'paused'));

  const result = await db(req)(
    `UPDATE rules SET
       name=$1, description=$2, condition=$3, action=$4, condition_type=$5, threshold=$6,
       action_type=$7, enabled=$8, status=$9, priority=$10, severity=$11, mode=$12,
       scope=$13::jsonb, conditions=$14::jsonb, actions=$15::jsonb, condition_logic=$16,
       schedule=$17::jsonb, cooldown_seconds=$18, evaluation_window_seconds=$19,
       deduplication=$20::jsonb, tags=$21::jsonb, version=$22, updated_by=$23, updated_at=NOW()
      WHERE id=$24 AND ($25::uuid IS NULL OR org_id=$25) AND deleted_at IS NULL
      RETURNING *`,
    [
      input.name || base.name, input.description === undefined ? base.description : input.description,
      input.condition || base.condition || null, input.action || base.action || null,
      input.condition_type || base.condition_type || null, input.threshold === undefined ? base.threshold : input.threshold,
      input.action_type || base.action_type || null, enabled, status,
      input.priority === undefined ? Number(base.priority || 50) : Number(input.priority),
      input.severity || base.severity || 'medium', input.mode || base.mode || 'live',
      JSON.stringify(input.scope || base.scope || { type: 'org' }), JSON.stringify(conditions), JSON.stringify(actions),
      input.condition_logic || base.condition_logic || 'all', JSON.stringify(input.schedule || base.schedule || { enabled: false }),
      input.cooldown_seconds === undefined ? Number(base.cooldown_seconds || 900) : Number(input.cooldown_seconds),
      input.evaluation_window_seconds === undefined ? Number(base.evaluation_window_seconds || 0) : Number(input.evaluation_window_seconds),
      JSON.stringify(input.deduplication || base.deduplication || { strategy: 'rule_subject', ttl_seconds: 900 }),
      JSON.stringify(Array.isArray(input.tags) ? input.tags : (base.tags || [])), nextVersion, req.user.id,
      req.params.id, orgId(req),
    ],
  );

  await db(req)(
    `INSERT INTO rule_versions (rule_id, org_id, version, snapshot, change_type, changed_by)
     VALUES ($1,$2,$3,$4::jsonb,'update',$5)`,
    [req.params.id, orgId(req), nextVersion, JSON.stringify(result.rows[0]), req.user.id],
  );
  res.json({ data: result.rows[0] });
}));

router.delete('/:id', authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const result = await db(req)(
    `UPDATE rules SET status='archived', enabled=false, deleted_at=NOW(), updated_at=NOW(), updated_by=$3
      WHERE id=$1 AND ($2::uuid IS NULL OR org_id=$2) AND deleted_at IS NULL RETURNING id`,
    [req.params.id, orgId(req), req.user.id],
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Rule not found' });
  res.status(204).send();
}));

// app.js predates the operator notifications router. Mount the compatibility
// route after app.js has finished constructing/exporting the Express instance.
process.nextTick(() => {
  try {
    const app = require('../app').app;
    if (app && !app.__sonalitNotificationsMounted) {
      app.__sonalitNotificationsMounted = true;
      app.use('/api/v1/notifications', require('./notifications'));
    }
  } catch (_) {}
});

module.exports = router;
