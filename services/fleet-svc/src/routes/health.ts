import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { redis } from '../redis.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz/live', async (_request, reply) => {
    await reply.status(200).send({ status: 'ok' });
  });

  app.get('/healthz/ready', async (_request, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    try {
      await pool.query('SELECT 1');
      checks['db'] = 'ok';
    } catch (err) {
      checks['db'] = err instanceof Error ? err.message : 'error';
      healthy = false;
    }

    try {
      await redis.ping();
      checks['redis'] = 'ok';
    } catch (err) {
      checks['redis'] = err instanceof Error ? err.message : 'error';
      healthy = false;
    }

    await reply.status(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
  });
};
