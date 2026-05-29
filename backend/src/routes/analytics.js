const router = require('express').Router();
const c = require('../controllers/analyticsController');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');

router.use(authenticate, attachOrgDb);

router.get('/dashboard', c.getDashboard);
router.get('/fleet-utilization', c.getFleetUtilization);
router.get('/convoy-metrics', c.getConvoyMetrics);
router.get('/incident-heatmap', c.getIncidentHeatmap);

// GET /analytics/sla — SLA KPIs for Executive dashboard (F8)
// RULE B: all raw queries use req.db (org-scoped), no matview reads here
router.get('/sla', asyncHandler(async (req, res) => {
  const days = Math.min(90, parseInt(req.query.days) || 30);

  const [convoyRes, fuelRes, claimRes, anomalyRes, shiftRes, behavRes] = await Promise.all([
    req.db(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status = 'aborted') AS aborted,
         COUNT(*) AS total,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE status = 'completed' AND COALESCE(arrived_at, updated_at) <= COALESCE(estimated_arrival_at, updated_at + INTERVAL '1 day'))
           / NULLIF(COUNT(*) FILTER (WHERE status = 'completed'), 0)
         , 1) AS on_time_pct
       FROM convoys
       WHERE deleted_at IS NULL AND created_at > NOW() - ($1 || ' days')::interval`,
      [days],
    ),
    req.db(
      `SELECT ROUND(SUM(total_cost)::numeric, 2) AS total_fuel_cost,
              ROUND(SUM(litres)::numeric, 1) AS total_litres
       FROM fuel_entries WHERE deleted_at IS NULL AND created_at > NOW() - ($1 || ' days')::interval`,
      [days],
    ).catch(() => ({ rows: [{}] })),
    req.db(
      `SELECT COUNT(*) FILTER (WHERE status = 'draft') AS draft_claims,
              COUNT(*) FILTER (WHERE status = 'submitted') AS submitted_claims,
              COUNT(*) AS total_claims
       FROM insurance_claims WHERE created_at > NOW() - ($1 || ' days')::interval`,
      [days],
    ).catch(() => ({ rows: [{}] })),
    req.db(
      `SELECT COUNT(*) FILTER (WHERE resolved = false) AS open_anomalies,
              COUNT(*) AS total_anomalies
       FROM fuel_anomalies WHERE created_at > NOW() - ($1 || ' days')::interval`,
      [days],
    ).catch(() => ({ rows: [{}] })),
    req.db(
      `SELECT COUNT(*) FILTER (WHERE status = 'active') AS active_shifts,
              COUNT(*) FILTER (WHERE status = 'no_show') AS no_shows
       FROM shifts WHERE created_at > NOW() - ($1 || ' days')::interval`,
      [days],
    ).catch(() => ({ rows: [{}] })),
    req.db(
      `SELECT COUNT(*) AS behaviour_events,
              COUNT(DISTINCT driver_id) AS drivers_flagged
       FROM driver_behaviour_events
       WHERE deleted_at IS NULL AND created_at > NOW() - ($1 || ' days')::interval`,
      [days],
    ).catch(() => ({ rows: [{}] })),
  ]);

  res.json({
    data: {
      days,
      convoys: convoyRes.rows[0] ?? {},
      fuel: fuelRes.rows[0] ?? {},
      claims: claimRes.rows[0] ?? {},
      anomalies: anomalyRes.rows[0] ?? {},
      shifts: shiftRes.rows[0] ?? {},
      behaviour: behavRes.rows[0] ?? {},
    },
  });
}));

module.exports = router;
