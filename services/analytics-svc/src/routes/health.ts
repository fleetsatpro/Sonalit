import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz/live', async (_req, reply) => {
    await reply.send({ status: 'ok' });
  });

  app.get('/healthz/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};

    try {
      await pool.query('SELECT 1');
      checks['db'] = 'ok';
    } catch {
      checks['db'] = 'error';
    }

    const allOk = checks['db'] === 'ok';
    await reply.code(allOk ? 200 : 503).send({ status: allOk ? 'ok' : 'degraded', checks });
  });
}
