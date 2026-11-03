import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { isRedisReady } from '../redis.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  app.get('/healthz/ready', async (_request, reply) => {
    const checks = await Promise.allSettled([
      pool.query('SELECT 1'),
      isRedisReady(),
    ]);

    const dbOk = checks[0].status === 'fulfilled';
    const redisOk = checks[1].status === 'fulfilled' && checks[1].value === true;

    if (!dbOk || !redisOk) {
      return reply.status(503).send({
        status: 'not ready',
        db: dbOk,
        redis: redisOk,
      });
    }

    return reply.status(200).send({ status: 'ready', db: true, redis: true });
  });
}
