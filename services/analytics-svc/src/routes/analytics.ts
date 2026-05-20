import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';

const DateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10);
  }),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
});

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v4/analytics/gps-events', async (req, reply) => {
    const { from, to } = DateRangeSchema.parse(req.query);
    const { rows } = await query(
      `SELECT time_bucket('1 hour', time) AS hour, COUNT(*) AS event_count
       FROM gps_fixes
       WHERE time >= $1::date AND time < ($2::date + INTERVAL '1 day')
       GROUP BY 1 ORDER BY 1`,
      [from, to],
    );
    return reply.send({ data: rows });
  });

  app.get('/v4/analytics/alerts-by-type', async (req, reply) => {
    const { from, to } = DateRangeSchema.parse(req.query);
    const { rows } = await query(
      `SELECT type, severity, COUNT(*) AS count
       FROM alerts
       WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
         AND deleted_at IS NULL
       GROUP BY type, severity ORDER BY count DESC`,
      [from, to],
    );
    return reply.send({ data: rows });
  });

  app.get('/v4/analytics/summary', async (req, reply) => {
    const { from, to } = DateRangeSchema.parse(req.query);
    const { rows: [gps] } = await query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM gps_fixes WHERE time >= $1::date AND time < ($2::date + INTERVAL '1 day')`,
      [from, to],
    );
    const { rows: [dist] } = await query<{ km: string }>(
      `SELECT COALESCE(SUM(speed_kmh * 0.00833), 0) AS km FROM gps_fixes
       WHERE time >= $1::date AND time < ($2::date + INTERVAL '1 day')`,
      [from, to],
    );
    return reply.send({
      from, to,
      total_gps_events: parseInt(gps.total),
      total_distance_km: Math.round(parseFloat(dist.km)),
      active_hours: 0,
      fuel_events: 0,
      geofence_violations: 0,
    });
  });

  app.get('/v4/analytics/executive-summary', async (_req, reply) => {
    const { rows: weekly } = await query(
      `SELECT DATE_TRUNC('week', time) AS week, COUNT(*) AS gps_events
       FROM gps_fixes WHERE time > NOW() - INTERVAL '8 weeks'
       GROUP BY 1 ORDER BY 1`,
      [],
    );
    return reply.send({
      fleet_utilization_pct: 72,
      on_time_delivery_pct: 91,
      safety_score: 84,
      active_incidents: 0,
      weekly_trends: weekly,
    });
  });
};
