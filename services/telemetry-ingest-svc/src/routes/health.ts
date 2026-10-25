import type { FastifyInstance, FastifyReply } from 'fastify';
import { register, collectDefaultMetrics } from 'prom-client';
import { isRedisReady } from '../redis.js';
import { isNatsReady } from '../nats.js';
import { isDatabaseReady } from '../db.js';

collectDefaultMetrics({ register });

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz/live', async (_request, reply: FastifyReply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  app.get('/healthz/ready', async (_request, reply: FastifyReply) => {
    const [databaseOk, redisOk, natsOk] = await Promise.all([
      isDatabaseReady(),
      isRedisReady(),
      isNatsReady(),
    ]);

    const checks = {
      database: databaseOk ? 'ok' : 'degraded',
      redis: redisOk ? 'ok' : 'degraded',
      nats: natsOk ? 'ok' : 'degraded',
    };

    // PostgreSQL-backed acceptance remains safe while the dispatcher is degraded.
    // Database persistence and Redis-backed auth/rate limiting define ingest readiness.
    const persistenceReady = databaseOk && redisOk;
    return reply.status(persistenceReady ? 200 : 503).send({
      status: persistenceReady ? 'ready' : 'not_ready',
      checks,
      telemetry_delivery: natsOk ? 'live' : 'durably_queued',
    });
  });

  app.get('/metrics', async (_request, reply: FastifyReply) => {
    const metrics = await register.metrics();
    return reply
      .status(200)
      .header('Content-Type', register.contentType)
      .send(metrics);
  });
}
