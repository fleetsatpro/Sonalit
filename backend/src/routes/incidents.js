const router = require('express').Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { publish } = require('../realtime/centrifugo');
const requireIdempotencyKey = require('../middleware/idempotency');
const { buildIncidentTimeline } = require('../services/incidents/timeline');
const { sealTimeline } = require('../services/incidents/integrity');

router.use(authenticate, attachOrgDb);

// attachOrgDb only sets req.db when req.user.org_id is present. This route
// previously never used attachOrgDb at all — every query ran through the
// raw, unscoped `query()` connection, so any authenticated user from any
// org could read/edit any other org's incidents. Fail closed instead of
// falling back to that.
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 100);
  const filters = [], params = [];
  // 'active' is a dashboard-widget convenience alias, not a real status
  // value — it means "still needs attention" (not resolved/closed), same
  // convention as panic_events.resolved_at IS NULL elsewhere in this app.
  if (req.query.status === 'active') filters.push(`status NOT IN ('resolved', 'closed')`);
  else if (req.query.status) { params.push(req.query.status); filters.push(`status = $${params.length}`); }
  if (req.query.severity) { params.push(req.query.severity); filters.push(`severity = $${params.length}`); }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await req.db(
    `SELECT * FROM incidents WHERE deleted_at IS NULL ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  res.json({ data: rows });
}));

router.post('/', requireIdempotencyKey, asyncHandler(async (req, res) => {
  const { convoy_id, title, description, severity = 'medium', type, assigned_to } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const { rows } = await req.db(
    `INSERT INTO incidents (convoy_id, title, description, severity, status, type, assigned_to, org_id)
     VALUES ($1,$2,$3,$4,'open',$5,$6,$7) RETURNING *`,
    [convoy_id || null, title, description || null, severity, type || null, assigned_to || null, req.user.org_id]
  );

  publish(`org#${req.user.org_id}`, { type: 'incident.new', incidentId: rows[0].id, severity: rows[0].severity, title: rows[0].title });
  res.status(201).json({ data: rows[0] });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { status, severity, description, notes, assigned_to } = req.body;
  const { rows } = await req.db(
    `UPDATE incidents
     SET status=COALESCE($1,status), severity=COALESCE($2,severity), description=COALESCE($3,description),
         notes=COALESCE($4,notes), assigned_to=COALESCE($5,assigned_to), updated_at=NOW()
     WHERE id=$6 AND deleted_at IS NULL RETURNING *`,
    [status, severity, description, notes, assigned_to, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Incident not found' });

  publish(`org#${req.user.org_id}`, { type: 'incident.updated', incidentId: rows[0].id, status: rows[0].status });
  res.json({ data: rows[0] });
}));

router.post('/:id/comments', asyncHandler(async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  const { rows } = await req.db(
    `UPDATE incidents SET description=COALESCE(description,'')||E'\n[Comment] '||$1, updated_at=NOW()
     WHERE id=$2 AND deleted_at IS NULL RETURNING *`,
    [content, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Incident not found' });

  publish(`org#${req.user.org_id}`, { type: 'incident.updated', incidentId: rows[0].id });
  res.json({ data: rows[0] });
}));

// GET /:deviceId/reconstruct?from=&to= — incident dossier for a Guardian device.
// Fuses SOS panics, covert captures, dispatch commands, two-way voice and the
// GPS trail (condensed to unscheduled stops) into one chronological, tamper-
// sealed timeline. Defaults to the last 24h. Device ownership is verified
// against the caller's org before any telemetry is read.
router.get('/:deviceId/reconstruct', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 3600 * 1000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ error: 'invalid from/to' });
  }
  if (from >= to) return res.status(400).json({ error: 'from must be before to' });

  const dev = await query(
    `SELECT id, name FROM guardian_devices WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
    [req.params.deviceId, orgId]
  );
  if (!dev.rows.length) return res.status(404).json({ error: 'Device not found' });

  const events = await buildIncidentTimeline({
    query, deviceId: req.params.deviceId, from: from.toISOString(), to: to.toISOString(),
  });
  const integrity = sealTimeline(events);

  res.json({ data: {
    device: { id: dev.rows[0].id, name: dev.rows[0].name },
    window: { from: from.toISOString(), to: to.toISOString() },
    events, integrity,
  } });
}));

module.exports = router;
