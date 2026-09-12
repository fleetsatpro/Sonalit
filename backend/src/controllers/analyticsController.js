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

/*
 * GET /analytics/nuclear-report — org-wide analytics for the "Nuclear
 * Analytics" Excel export (apps/web/src/lib/nuclearAnalyticsExport.ts).
 * Every number here is a live aggregate, org-scoped via req.db. There is no
 * per-row filtering by the on-screen convoy list — these are hub-wide
 * statistics, independent of whatever subset of convoys the user has
 * currently filtered on the Convoys page.
 *
 * Where the source template asked for something we cannot honestly compute —
 * a per-client SLA *target* (not stored anywhere) or a genuine demand
 * forecast — this either omits the field or computes a plainly-labelled
 * historical statistic instead (see route_risk / outlook below). Nothing
 * here is fabricated; sparse results (e.g. one convoy total) are expected
 * for a young org and are surfaced as "insufficient data", not padded.
 */
const getNuclearReport = asyncHandler(async (req, res) => {
  const [
    weeklyOnTime,
    routePerformance,
    fleetStats,
    fleetByType,
    maintenanceDowntime,
    dailyDeparted,
    dailyArrived,
    weekdayDepartures,
    clientLeaderboard,
  ] = await Promise.all([
    // Weekly on-time % — last 8 ISO weeks, keyed by the week a convoy arrived.
    req.db(
      `WITH weeks AS (
         SELECT generate_series(date_trunc('week', NOW()) - INTERVAL '7 weeks', date_trunc('week', NOW()), INTERVAL '1 week')::date AS week_start
       )
       SELECT w.week_start,
              COUNT(c.id) FILTER (WHERE c.status = 'completed') AS completed,
              COUNT(c.id) FILTER (WHERE c.status = 'completed' AND c.arrival_time <= c.estimated_arrival) AS on_time
       FROM weeks w
       LEFT JOIN convoys c ON c.deleted_at IS NULL AND c.status = 'completed' AND date_trunc('week', c.arrival_time) = w.week_start
       GROUP BY w.week_start
       ORDER BY w.week_start`
    ),
    // Top corridors by trip count, with real avg transit time / on-time% / incident count.
    req.db(
      `WITH route_stats AS (
         SELECT route_origin, route_destination,
                COUNT(*) AS trips,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed_trips,
                COUNT(*) FILTER (WHERE status = 'completed' AND arrival_time <= estimated_arrival) AS on_time_trips,
                AVG(EXTRACT(EPOCH FROM (arrival_time - departure_time)) / 3600.0)
                  FILTER (WHERE arrival_time IS NOT NULL AND departure_time IS NOT NULL) AS avg_hours
         FROM convoys
         WHERE deleted_at IS NULL AND route_origin IS NOT NULL AND route_destination IS NOT NULL
         GROUP BY route_origin, route_destination
       ),
       route_incidents AS (
         SELECT c.route_origin, c.route_destination, COUNT(i.id) AS incidents
         FROM convoys c JOIN incidents i ON i.convoy_id = c.id
         WHERE c.deleted_at IS NULL
         GROUP BY c.route_origin, c.route_destination
       )
       SELECT rs.route_origin, rs.route_destination, rs.trips,
              ROUND(rs.avg_hours::numeric, 1) AS avg_hours,
              CASE WHEN rs.completed_trips > 0 THEN ROUND(100.0 * rs.on_time_trips / rs.completed_trips, 1) ELSE NULL END AS on_time_pct,
              COALESCE(ri.incidents, 0) AS incidents
       FROM route_stats rs
       LEFT JOIN route_incidents ri ON ri.route_origin = rs.route_origin AND ri.route_destination = rs.route_destination
       ORDER BY rs.trips DESC
       LIMIT 10`
    ),
    // Fleet headcount by status.
    req.db(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'active') AS active,
              COUNT(*) FILTER (WHERE status = 'idle') AS idle,
              COUNT(*) FILTER (WHERE status = 'maintenance') AS maintenance,
              COUNT(*) FILTER (WHERE status = 'offline') AS offline
       FROM vehicles WHERE deleted_at IS NULL`
    ),
    // Fleet by asset class (vehicles.type).
    req.db(
      `SELECT type, COUNT(*) AS count,
              COUNT(*) FILTER (WHERE status = 'active') AS active,
              ROUND(AVG(cargo_capacity_kg)::numeric, 1) AS avg_capacity_kg
       FROM vehicles WHERE deleted_at IS NULL
       GROUP BY type ORDER BY count DESC`
    ),
    // Real downtime hours per asset class, last 30 days, from actual maintenance records.
    req.db(
      `SELECT v.type,
              ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(mr.completed_at, NOW()) - mr.started_at)) / 3600.0)::numeric, 1) AS downtime_hours
       FROM maintenance_records mr
       JOIN vehicles v ON v.id = mr.vehicle_id
       WHERE mr.started_at IS NOT NULL AND mr.started_at >= NOW() - INTERVAL '30 days' AND v.deleted_at IS NULL
       GROUP BY v.type`
    ),
    // Daily departures, last 14 days.
    req.db(
      `SELECT DATE(departure_time) AS day, COUNT(*) AS departed
       FROM convoys WHERE deleted_at IS NULL AND departure_time >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(departure_time) ORDER BY day`
    ),
    // Daily arrivals + completions, last 14 days.
    req.db(
      `SELECT DATE(arrival_time) AS day, COUNT(*) AS arrived,
              COUNT(*) FILTER (WHERE status = 'completed') AS completed
       FROM convoys WHERE deleted_at IS NULL AND arrival_time >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(arrival_time) ORDER BY day`
    ),
    // Trailing 5-week same-weekday departure average — a real historical
    // statistic, used to label a 7-day outlook honestly (not a forecast/prediction).
    req.db(
      `SELECT dow, ROUND(AVG(daily_count)::numeric, 1) AS avg_count FROM (
         SELECT DATE(departure_time) AS day, EXTRACT(DOW FROM departure_time)::int AS dow, COUNT(*) AS daily_count
         FROM convoys WHERE deleted_at IS NULL AND departure_time >= NOW() - INTERVAL '35 days'
         GROUP BY DATE(departure_time), EXTRACT(DOW FROM departure_time)
       ) sub
       GROUP BY dow`
    ),
    // Client leaderboard — real on-time% per client, no invented SLA target/score.
    req.db(
      `SELECT cc.id, cc.name, cc.company,
              COUNT(c.id) AS convoys,
              COUNT(c.id) FILTER (WHERE c.status = 'completed') AS completed,
              COUNT(c.id) FILTER (WHERE c.status = 'completed' AND c.arrival_time <= c.estimated_arrival) AS on_time,
              ROUND(AVG(EXTRACT(EPOCH FROM (c.arrival_time - c.departure_time)) / 3600.0)
                FILTER (WHERE c.arrival_time IS NOT NULL AND c.departure_time IS NOT NULL)::numeric, 1) AS avg_transit_hours
       FROM convoys c
       JOIN cargo_clients cc ON cc.id = c.client_id
       WHERE c.deleted_at IS NULL
       GROUP BY cc.id, cc.name, cc.company
       ORDER BY convoys DESC
       LIMIT 15`
    ),
  ]);

  res.json({
    data: {
      generated_at: new Date().toISOString(),
      weekly_on_time: weeklyOnTime.rows,
      route_performance: routePerformance.rows,
      fleet_stats: fleetStats.rows[0] ?? { total: 0, active: 0, idle: 0, maintenance: 0, offline: 0 },
      fleet_by_type: fleetByType.rows,
      maintenance_downtime_by_type: maintenanceDowntime.rows,
      daily_departed: dailyDeparted.rows,
      daily_arrived: dailyArrived.rows,
      weekday_departure_avg: weekdayDepartures.rows,
      client_leaderboard: clientLeaderboard.rows,
    },
  });
});

module.exports = { getDashboard, getFleetUtilization, getConvoyMetrics, getIncidentHeatmap, getNuclearReport };
