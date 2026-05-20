import type { FastifyInstance, FastifyReply } from 'fastify';
import { register, collectDefaultMetrics } from 'prom-client';
import { isRedisReady } from '../redis.js';
import { isNatsReady } from '../nats.js';

collectDefaultMetrics({ register });

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz/live', async (_request, reply: FastifyReply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  app.get('/healthz/ready', async (_request, reply: FastifyReply) => {
    const [redisOk, natsOk] = await Promise.all([
      isRedisReady(),
      isNatsReady(),
    ]);

    const checks = {
      redis: redisOk ? 'ok' : 'degraded',
      nats: natsOk ? 'ok' : 'degraded',
    };

    const allOk = redisOk && natsOk;
    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? 'ready' : 'not_ready',
      checks,
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
