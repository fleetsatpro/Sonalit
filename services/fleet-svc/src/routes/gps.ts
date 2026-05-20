import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const ListQuerySchema = z.object({
  device_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const gpsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth(app));

  app.get('/v4/gps/track', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const q = ListQuerySchema.parse(req.query);
    const params: unknown[] = [org_id];
    let deviceFilter = '';
    if (q.device_id) {
      params.push(q.device_id);
      deviceFilter = `AND device_id = $${params.length}`;
    }
    params.push(q.limit);
    const { rows } = await query(
      `SELECT DISTINCT ON (device_id)
              device_id, lat, lon, speed_kmh, heading, accuracy_m, time AS ts
       FROM gps_fixes
       WHERE org_id = $1 ${deviceFilter}
       ORDER BY device_id, time DESC
       LIMIT $${params.length}`,
      params,
    );
    return reply.send({ data: rows });
  });
};
