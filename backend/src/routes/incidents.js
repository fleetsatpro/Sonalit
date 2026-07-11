const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { publish } = require('../realtime/centrifugo');
const requireIdempotencyKey = require('../middleware/idempotency');

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

module.exports = router;
