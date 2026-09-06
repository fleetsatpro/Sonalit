const router = require('express').Router();
const Joi = require('joi');
const { query } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { analyseRoute } = require('../utils/routeAnalyser');
const { asyncHandler } = require('../middleware/error');
const logger = require('../utils/logger');

router.use(authenticate, attachOrgDb);

const analyseSchema = Joi.object({
  origin: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).required(),
  destination: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).required(),
  convoy_id: Joi.string().uuid().optional(),
  departure_time: Joi.string().isoDate().optional(),
  preferences: Joi.object({
    avoid_night_travel: Joi.boolean().optional(),
    max_risk_score: Joi.number().min(0).max(100).optional(),
  }).optional(),
});

// POST /api/v1/routes/analyse
router.post('/analyse', authorize('admin', 'dispatcher', 'operator'), asyncHandler(async (req, res) => {
  const { error, value } = analyseSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const analysis = await analyseRoute({
    origin: value.origin,
    destination: value.destination,
    convoyId: value.convoy_id,
    requestedBy: req.user.id,
    departureTime: value.departure_time,
    avoidNightTravel: value.preferences?.avoid_night_travel ?? false,
    orgId: req.user.org_id,
  });

  const result = await req.db(
    `INSERT INTO route_analyses
       (org_id, convoy_id, origin_lat, origin_lng, destination_lat, destination_lng,
        overall_risk_score, primary_risk_factors, recommended_route, alternate_routes,
        ai_summary, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      analysis.org_id,
      analysis.convoy_id,
      analysis.origin_lat,
      analysis.origin_lng,
      analysis.destination_lat,
      analysis.destination_lng,
      analysis.overall_risk_score,
      JSON.stringify(analysis.primary_risk_factors),
      JSON.stringify(analysis.recommended_route),
      JSON.stringify(analysis.alternate_routes),
      analysis.ai_summary,
      analysis.requested_by,
    ],
  );

  res.status(201).json({ data: result.rows[0] });
}));

// GET /api/v1/routes/analyses
router.get('/analyses', asyncHandler(async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);

  const result = await req.db(
    `SELECT ra.*, u.name AS requested_by_name
     FROM route_analyses ra
     LEFT JOIN users u ON u.id = ra.requested_by
     ORDER BY ra.analysed_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  const total = await req.db(
    `SELECT COUNT(*) AS count FROM route_analyses`,
    [],
  );

  res.json({ data: result.rows, total: parseInt(total.rows[0]?.count ?? 0) });
}));

// GET /api/v1/routes/analyses/:id
router.get('/analyses/:id', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT ra.*, u.name AS requested_by_name
     FROM route_analyses ra
     LEFT JOIN users u ON u.id = ra.requested_by
     WHERE ra.id = $1`,
    [req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Analysis not found' });
  res.json({ data: result.rows[0] });
}));

module.exports = router;
