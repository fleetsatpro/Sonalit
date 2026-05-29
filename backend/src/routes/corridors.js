/**
 * Convoy route corridor endpoints.
 * Mounted at /api/v1/convoys so that:
 *   GET  /api/v1/convoys/:id/corridor
 *   POST /api/v1/convoys/:id/corridor
 *   GET  /api/v1/convoys/:id/corridor/deviations
 */
const router = require('express').Router({ mergeParams: true });
const Joi = require('joi');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');

router.use(authenticate, attachOrgDb);

// GET /api/v1/convoys/:id/corridor
router.get('/:id/corridor', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT * FROM convoy_route_corridors WHERE convoy_id = $1`,
    [req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'No corridor for this convoy' });
  const row = result.rows[0];
  res.json({ data: { ...row, route_line: typeof row.route_line === 'string' ? JSON.parse(row.route_line) : row.route_line } });
}));

// POST /api/v1/convoys/:id/corridor
const corridorSchema = Joi.object({
  route_line: Joi.array().items(Joi.object({ lat: Joi.number().required(), lng: Joi.number().required() })).min(2),
  width_km: Joi.number().positive().default(2.0),
  from_analysis: Joi.boolean(),
});

router.post('/:id/corridor', asyncHandler(async (req, res) => {
  const { error, value } = corridorSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  let routeLine = value.route_line;

  // Copy geometry from an existing route_analysis if requested
  if (value.from_analysis && !routeLine) {
    const analysis = await req.db(
      `SELECT waypoints FROM route_analyses WHERE convoy_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.id],
    );
    if (!analysis.rows.length) return res.status(404).json({ error: 'No route analysis found for this convoy' });
    const wp = typeof analysis.rows[0].waypoints === 'string'
      ? JSON.parse(analysis.rows[0].waypoints) : analysis.rows[0].waypoints;
    routeLine = Array.isArray(wp) ? wp : [];
  }

  if (!routeLine || routeLine.length < 2) {
    return res.status(400).json({ error: 'route_line must have at least 2 points' });
  }

  const convoyCheck = await req.db(
    `SELECT id, org_id FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id],
  );
  if (!convoyCheck.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const result = await req.db(
    `INSERT INTO convoy_route_corridors (org_id, convoy_id, route_line, width_km)
     VALUES ((current_setting('app.current_org_id',true))::uuid, $1, $2, $3)
     ON CONFLICT (convoy_id) DO UPDATE
       SET route_line = EXCLUDED.route_line, width_km = EXCLUDED.width_km,
           active = true
     RETURNING *`,
    [req.params.id, JSON.stringify(routeLine), value.width_km],
  );

  res.status(201).json({ data: result.rows[0] });
}));

// GET /api/v1/convoys/:id/corridor/deviations
router.get('/:id/corridor/deviations', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const result = await req.db(
    `SELECT e.* FROM geofence_events e
      WHERE e.convoy_id = $1 AND e.event_type = 'route_deviation'
      ORDER BY e.created_at DESC
      LIMIT $2`,
    [req.params.id, limit],
  );
  res.json({ data: result.rows });
}));

module.exports = router;
