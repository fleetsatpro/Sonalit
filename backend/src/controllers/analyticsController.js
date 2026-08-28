const { asyncHandler } = require('../middleware/error');

const getDashboard = asyncHandler(async (req, res) => {
  const [activeConvoys, fleetUtil, openAlerts, onTimeRate, totalVehicles, activeVehicles] = await Promise.all([
    req.db(`SELECT COUNT(*) FROM convoys WHERE status = 'active' AND deleted_at IS NULL`),
    req.db(`SELECT
             COUNT(*) FILTER (WHERE status = 'active') AS active,
             COUNT(*) FILTER (WHERE status = 'idle') AS idle,
             COUNT(*) TOTAL
           FROM vehicles WHERE deleted_at IS NULL`),
    req.db(`SELECT COUNT(*) FROM alerts WHERE resolved_at IS NULL AND deleted_at IS NULL`),
    req.db(`SELECT
             COUNT(*) FILTER (WHERE arrival_time <= estimated_arrival AND status = 'completed') AS on_time,
             COUNT(*) FILTER (WHERE status = 'completed') AS total_completed
           FROM convoys WHERE deleted_at IS NULL`),
    req.db(`SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL`),
    req.db(`SELECT COUNT(*) FROM vehicles WHERE status = 'active' AND deleted_at IS NULL`),
  ]);

  const ot = onTimeRate.rows[0];
  const onTimePct = ot.total_completed > 0
    ? Math.round((ot.on_time / ot.total_completed) * 100)
    : 0;

  const fleet = fleetUtil.rows[0];
  const utilisationPct = fleet.total > 0
    ? Math.round((fleet.active / fleet.total) * 100)
    : 0;

  res.json({
    data: {
      activeConvoys: parseInt(activeConvoys.rows[0].count),
      openAlerts: parseInt(openAlerts.rows[0].count),
      fleetUtilisation: utilisationPct,
      onTimeRate: onTimePct,
      totalVehicles: parseInt(totalVehicles.rows[0].count),
      activeVehicles: parseInt(activeVehicles.rows[0].count),
    },
  });
});

const getFleetUtilization = asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT region,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'active') AS active,
            COUNT(*) FILTER (WHERE status = 'idle') AS idle,
            COUNT(*) FILTER (WHERE status = 'maintenance') AS maintenance,
            COUNT(*) FILTER (WHERE status = 'offline') AS offline
     FROM vehicles
     WHERE deleted_at IS NULL
     GROUP BY region
     ORDER BY region`
  );
  res.json({ data: result.rows });
});

const getConvoyMetrics = asyncHandler(async (req, res) => {
  // generate_series to fill gaps so every day in the last 30 appears
  const result = await req.db(
    `WITH days AS (
       SELECT generate_series(
         NOW() - INTERVAL '29 days',
         NOW(),
         INTERVAL '1 day'
       )::date AS day
     )
     SELECT
       d.day,
       COUNT(c.id) FILTER (WHERE c.status = 'completed') AS completed,
       COUNT(c.id) FILTER (WHERE c.status = 'completed' AND c.arrival_time <= c.estimated_arrival) AS on_time,
       COUNT(c.id) FILTER (WHERE c.status = 'completed' AND c.arrival_time > c.estimated_arrival) AS delayed,
       COUNT(c.id) FILTER (WHERE c.status = 'aborted') AS aborted
     FROM days d
     LEFT JOIN convoys c
       ON c.deleted_at IS NULL
       AND DATE(c.updated_at) = d.day
     GROUP BY d.day
     ORDER BY d.day ASC`
  );
  res.json({ data: result.rows });
});

const getIncidentHeatmap = asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT c.region,
            COUNT(i.id) AS incident_count,
            COUNT(i.id) FILTER (WHERE i.severity = 'critical') AS critical,
            COUNT(i.id) FILTER (WHERE i.severity = 'high') AS high,
            COUNT(i.id) FILTER (WHERE i.severity = 'medium') AS medium
     FROM incidents i
     JOIN convoys c ON c.id = i.convoy_id AND c.deleted_at IS NULL
     WHERE i.created_at >= NOW() - INTERVAL '90 days'
     GROUP BY c.region
     ORDER BY incident_count DESC`
  );
  res.json({ data: result.rows });
});

module.exports = { getDashboard, getFleetUtilization, getConvoyMetrics, getIncidentHeatmap };
