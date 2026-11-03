import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { redis } from '../redis.js';
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz/live', async (_req, reply) => reply.send({ status: 'ok' }));
  app.get('/healthz/ready', async (_req, reply) => {
    try { await pool.query('SELECT 1'); await redis.ping(); return reply.send({ status: 'ok' }); }
    catch (err) { return reply.code(503).send({ status: 'error', error: String(err) }); }
  });
};
