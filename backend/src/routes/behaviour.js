/**
 * S2-F3: Driver Behaviour Scoring endpoints
 * RULE B: matview reads always include WHERE org_id = $1
 */
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { pool } = require('../config/database');

router.use(authenticate, attachOrgDb);

// GET /behaviour/drivers/:id/events — raw behaviour events for a driver
router.get('/drivers/:id/events', asyncHandler(async (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit) || 100);
  const days = Math.min(90, parseInt(req.query.days) || 30);
  const result = await req.db(
    `SELECT * FROM driver_behaviour_events
      WHERE driver_id = $1
        AND deleted_at IS NULL
        AND created_at > NOW() - ($2 || ' days')::interval
      ORDER BY created_at DESC
      LIMIT $3`,
    [req.params.id, days, limit],
  );
  res.json({ data: result.rows });
}));

// GET /behaviour/drivers/:id/score — score from matview (RULE B: explicit WHERE org_id)
router.get('/drivers/:id/score', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  // RULE B: direct pool query with WHERE org_id = $1 (matview bypasses RLS)
  const result = await pool.query(
    `SELECT * FROM driver_scores_30d WHERE org_id = $1 AND driver_id = $2`,
    [orgId, req.params.id],
  );
  if (!result.rows.length) return res.json({ data: { driver_id: req.params.id, score: 100, total_events: 0 } });
  res.json({ data: result.rows[0] });
}));

// GET /behaviour/leaderboard — top 20 by score
router.get('/leaderboard', asyncHandler(async (req, res) => {
  const orgId = req.user.org_id;
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  // RULE B: matview read with explicit org_id filter
  const result = await pool.query(
    `SELECT s.*, u.name AS driver_name
       FROM driver_scores_30d s
       LEFT JOIN users u ON u.id = s.driver_id
      WHERE s.org_id = $1
      ORDER BY s.score DESC
      LIMIT $2`,
    [orgId, limit],
  );
  res.json({ data: result.rows });
}));

// GET /behaviour/drivers/:id/score/history — 30-day event trend (grouped by day)
router.get('/drivers/:id/score/history', asyncHandler(async (req, res) => {
  const days = Math.min(90, parseInt(req.query.days) || 30);
  const result = await req.db(
    `SELECT
       DATE_TRUNC('day', created_at) AS day,
       event_type,
       COUNT(*) AS count
     FROM driver_behaviour_events
     WHERE driver_id = $1
       AND deleted_at IS NULL
       AND created_at > NOW() - ($2 || ' days')::interval
     GROUP BY day, event_type
     ORDER BY day DESC`,
    [req.params.id, days],
  );
  res.json({ data: result.rows });
}));

// POST /behaviour/refresh — manually trigger matview refresh (admin use)
router.post('/refresh', asyncHandler(async (_req, res) => {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY driver_scores_30d');
  res.json({ ok: true });
}));

module.exports = router;
