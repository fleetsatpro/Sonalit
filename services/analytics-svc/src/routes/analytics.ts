import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { AuthError } from '../lib/errors.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_ANALYTICS_RANGE_DAYS = 366;

const DateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10);
  }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
}).superRefine((range, context) => {
  const fromMs = Date.parse(`${range.from}T00:00:00.000Z`);
  const toMs = Date.parse(`${range.to}T00:00:00.000Z`);
  const fromValid = Number.isFinite(fromMs) && new Date(fromMs).toISOString().slice(0, 10) === range.from;
  const toValid = Number.isFinite(toMs) && new Date(toMs).toISOString().slice(0, 10) === range.to;

  if (!fromValid) context.addIssue({ code: 'custom', path: ['from'], message: 'from must be a valid calendar date' });
  if (!toValid) context.addIssue({ code: 'custom', path: ['to'], message: 'to must be a valid calendar date' });
  if (!fromValid || !toValid) return;

  if (fromMs > toMs) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'to must be on or after from' });
    return;
  }

  const inclusiveDays = Math.floor((toMs - fromMs) / MILLISECONDS_PER_DAY) + 1;
  if (inclusiveDays > MAX_ANALYTICS_RANGE_DAYS) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: `date range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days`,
    });
  }
});
type GpsDistanceStats = {
  km: string | null;
  valid_segments: string;
  rejected_speed_segments: string;
  gap_excluded_segments: string;
};

type FleetUtilizationStats = {
  total_vehicles: string;
  utilized_vehicles: string;
};

type DeliveryStats = {
  eligible_deliveries: string;
  on_time_deliveries: string;
};

type IncidentStats = {
  active_incidents: string;
};

const DISTANCE_MAX_GAP_SECONDS = 300;
const DISTANCE_MAX_PLAUSIBLE_SPEED_KMH = 180;
const ACTIVE_TRIP_STATUSES = ['locked', 'dispatched', 'checkpoint', 'delayed', 'at_port'];

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/v4/analytics/gps-events', async (req, reply) => {
    const org_id = req.user?.org_id;
    if (!org_id) throw new AuthError('tenant scope missing');
    const { from, to } = DateRangeSchema.parse(req.query);
    const rows = await query(
      `SELECT time_bucket('1 hour', time) AS hour, COUNT(*) AS event_count
       FROM gps_fixes
       WHERE org_id = $1 AND time >= $2::date AND time < ($3::date + INTERVAL '1 day')
       GROUP BY 1 ORDER BY 1`,
      [org_id, from, to],
    );
    return reply.send({ data: rows });
  });

  app.get('/v4/analytics/alerts-by-type', async (req, reply) => {
    const org_id = req.user?.org_id;
    if (!org_id) throw new AuthError('tenant scope missing');
    const { from, to } = DateRangeSchema.parse(req.query);
    const rows = await query(
      `SELECT type, severity, COUNT(*) AS count
       FROM alerts
       WHERE org_id = $1
         AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')
         AND deleted_at IS NULL
       GROUP BY type, severity ORDER BY count DESC`,
      [org_id, from, to],
    );
    return reply.send({ data: rows });
  });

  app.get('/v4/analytics/summary', async (req, reply) => {
    const org_id = req.user?.org_id;
    if (!org_id) throw new AuthError('tenant scope missing');
    const { from, to } = DateRangeSchema.parse(req.query);
    const [gps] = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM gps_fixes
       WHERE org_id = $1 AND time >= $2::date AND time < ($3::date + INTERVAL '1 day')`,
      [org_id, from, to],
    );
    const [distance] = await query<GpsDistanceStats>(
      `WITH windowed_fixes AS (
         SELECT device_id, seq_no, time, lat, lon,
                LAG(time) OVER (PARTITION BY device_id ORDER BY time, seq_no) AS previous_time,
                LAG(lat) OVER (PARTITION BY device_id ORDER BY time, seq_no) AS previous_lat,
                LAG(lon) OVER (PARTITION BY device_id ORDER BY time, seq_no) AS previous_lon
           FROM gps_fixes
          WHERE org_id = $1
            AND time >= ($2::date - INTERVAL '5 minutes')
            AND time < ($3::date + INTERVAL '1 day')
       ),
       candidate_segments AS (
         SELECT time,
                EXTRACT(EPOCH FROM (time - previous_time)) AS elapsed_seconds,
                2 * 6371.0088 * ASIN(SQRT(LEAST(1.0, GREATEST(0.0,
                  POWER(SIN(RADIANS(lat - previous_lat) / 2.0), 2)
                  + COS(RADIANS(previous_lat)) * COS(RADIANS(lat))
                    * POWER(SIN(RADIANS(lon - previous_lon) / 2.0), 2)
                )))) AS distance_km
           FROM windowed_fixes
          WHERE time >= $2::date
            AND previous_time IS NOT NULL
            AND time > previous_time
       ),
       scored_segments AS (
         SELECT *,
                distance_km * 3600.0 / NULLIF(elapsed_seconds, 0) AS implied_speed_kmh
           FROM candidate_segments
       )
       SELECT
         COUNT(*) FILTER (
           WHERE elapsed_seconds <= $4 AND implied_speed_kmh <= $5
         )::text AS valid_segments,
         COUNT(*) FILTER (
           WHERE elapsed_seconds <= $4 AND implied_speed_kmh > $5
         )::text AS rejected_speed_segments,
         COUNT(*) FILTER (
           WHERE elapsed_seconds > $4
         )::text AS gap_excluded_segments,
         SUM(distance_km) FILTER (
           WHERE elapsed_seconds <= $4 AND implied_speed_kmh <= $5
         )::text AS km
       FROM scored_segments`,
      [org_id, from, to, DISTANCE_MAX_GAP_SECONDS, DISTANCE_MAX_PLAUSIBLE_SPEED_KMH],
    );

    const validSegments = Number.parseInt(distance?.valid_segments ?? '0', 10);
    const rejectedSpeedSegments = Number.parseInt(distance?.rejected_speed_segments ?? '0', 10);
    const gapExcludedSegments = Number.parseInt(distance?.gap_excluded_segments ?? '0', 10);
    const km = distance?.km == null ? null : Number.parseFloat(distance.km);
    const totalDistanceKm = validSegments > 0 && km !== null && Number.isFinite(km)
      ? Math.round(km * 10) / 10
      : null;
    const distanceAvailable = totalDistanceKm !== null;

    return reply.send({
      from,
      to,
      total_gps_events: Number.parseInt(gps?.total ?? '0', 10),
      total_distance_km: totalDistanceKm,
      distance_method: 'gps_coordinate_segments',
      distance_valid_segments: validSegments,
      distance_rejected_speed_segments: rejectedSpeedSegments,
      distance_gap_excluded_segments: gapExcludedSegments,
      active_hours: null,
      fuel_events: null,
      geofence_violations: null,
      metric_status: {
        total_distance_km: distanceAvailable ? 'measured' : 'unavailable',
        active_hours: 'unavailable',
        fuel_events: 'unavailable',
        geofence_violations: 'unavailable',
      },
      metric_definitions: {
        total_distance_km: 'Sum of consecutive same-device GPS coordinate segments no more than 5 minutes apart and with implied segment speed no greater than 180 km/h. Longer gaps and implausible jumps are excluded.',
        active_hours: 'Unavailable: no source-backed active-hours aggregation is wired to this endpoint.',
        fuel_events: 'Unavailable: no source-backed fuel-event source is wired to this endpoint.',
        geofence_violations: 'Unavailable: no source-backed geofence-violation aggregation is wired to this endpoint.',
      },
    });
  });

  app.get('/v4/analytics/executive-summary', async (req, reply) => {
    const org_id = req.user?.org_id;
    if (!org_id) throw new AuthError('tenant scope missing');

    const [weekly, fleet, deliveries, incidents] = await Promise.all([
      query(
        `SELECT DATE_TRUNC('week', time) AS week, COUNT(*) AS gps_events
         FROM gps_fixes
         WHERE org_id = $1 AND time > NOW() - INTERVAL '8 weeks'
         GROUP BY 1 ORDER BY 1`,
        [org_id],
      ),
      query<FleetUtilizationStats>(
        `SELECT COUNT(DISTINCT v.id)::text AS total_vehicles,
                COUNT(DISTINCT t.vehicle_id)::text AS utilized_vehicles
           FROM cds_vehicles v
           LEFT JOIN cds_trips t
             ON t.vehicle_id = v.id
            AND t.org_id = v.org_id
            AND t.deleted_at IS NULL
            AND t.status = ANY($2::text[])
          WHERE v.org_id = $1
            AND v.deleted_at IS NULL`,
        [org_id, ACTIVE_TRIP_STATUSES],
      ),
      query<DeliveryStats>(
        `SELECT COUNT(*)::text AS eligible_deliveries,
                COUNT(*) FILTER (WHERE delivered_at <= eta)::text AS on_time_deliveries
           FROM cds_trips
          WHERE org_id = $1
            AND deleted_at IS NULL
            AND delivered_at IS NOT NULL
            AND delivered_at >= NOW() - INTERVAL '8 weeks'
            AND delivered_at <= NOW()
            AND eta IS NOT NULL`,
        [org_id],
      ),
      query<IncidentStats>(
        `SELECT COUNT(*)::text AS active_incidents
           FROM incidents
          WHERE org_id = $1
            AND deleted_at IS NULL
            AND status NOT IN ('resolved', 'closed')`,
        [org_id],
      ),
    ]);

    const fleetStats = fleet[0];
    const deliveryStats = deliveries[0];
    const incidentStats = incidents[0];
    const totalVehicles = fleetStats ? Number.parseInt(fleetStats.total_vehicles, 10) : 0;
    const utilizedVehicles = fleetStats ? Number.parseInt(fleetStats.utilized_vehicles, 10) : 0;
    const eligibleDeliveries = deliveryStats ? Number.parseInt(deliveryStats.eligible_deliveries, 10) : 0;
    const onTimeDeliveries = deliveryStats ? Number.parseInt(deliveryStats.on_time_deliveries, 10) : 0;

    return reply.send({
      fleet_utilization_pct: totalVehicles > 0
        ? Math.round((utilizedVehicles / totalVehicles) * 100)
        : null,
      on_time_delivery_pct: eligibleDeliveries > 0
        ? Math.round((onTimeDeliveries / eligibleDeliveries) * 100)
        : null,
      // No approved safety-score formula/source exists in this service. Null is
      // more truthful than a hard-coded number that looks measured.
      safety_score: null,
      active_incidents: incidentStats
        ? Number.parseInt(incidentStats.active_incidents, 10)
        : null,
      weekly_trends: weekly,
      metric_status: {
        fleet_utilization_pct: totalVehicles > 0 ? 'measured' : 'unavailable',
        on_time_delivery_pct: eligibleDeliveries > 0 ? 'measured' : 'unavailable',
        safety_score: 'unavailable',
        active_incidents: incidentStats ? 'measured' : 'unavailable',
      },
      metric_definitions: {
        fleet_utilization_pct: 'Current snapshot: distinct registered CDS vehicles assigned to trips in locked, dispatched, checkpoint, delayed, or at-port states divided by non-deleted registered CDS vehicles.',
        on_time_delivery_pct: 'Of CDS trips delivered in the last 8 weeks with a recorded ETA, the percentage delivered at or before that recorded ETA.',
        safety_score: 'Unavailable until an approved, source-backed safety-scoring rule and evidence pipeline are configured.',
        active_incidents: 'Current tenant-scoped incident count excluding resolved, closed, and deleted records.',
      },
    });
  });
};
