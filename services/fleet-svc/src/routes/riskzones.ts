import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const RiskLevel = z.enum(['low', 'medium', 'high', 'critical']);

const CreateRiskZoneSchema = z.object({
  h3_index: z.string().min(10).max(20),
  risk_level: RiskLevel,
  event_count: z.number().int().nonnegative().default(0),
  center_lat: z.number().min(-90).max(90),
  center_lon: z.number().min(-180).max(180),
});

const FilterSchema = z.object({
  risk_level: RiskLevel.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export const riskZonesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth(app));

  app.get('/v4/riskzones', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const q = FilterSchema.parse(req.query);
    const params: unknown[] = [org_id, q.limit];
    let riskFilter = '';
    if (q.risk_level) {
      params.push(q.risk_level);
      riskFilter = `AND risk_level = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT h3_index, risk_level, event_count, center_lat, center_lon, updated_at
       FROM risk_zones
       WHERE org_id = $1 ${riskFilter}
       ORDER BY event_count DESC
       LIMIT $2`,
      params,
    );
    return reply.send({ data: rows });
  });

  app.post('/v4/riskzones', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const body = CreateRiskZoneSchema.parse(req.body);
    const { rows: [row] } = await query(
      `INSERT INTO risk_zones (id, org_id, h3_index, risk_level, event_count, center_lat, center_lon)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (org_id, h3_index)
       DO UPDATE SET risk_level = EXCLUDED.risk_level,
                     event_count = EXCLUDED.event_count,
                     updated_at = NOW()
       RETURNING *`,
      [randomUUID(), org_id, body.h3_index, body.risk_level, body.event_count, body.center_lat, body.center_lon],
    );
    return reply.code(201).send(row);
  });
};
