import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { redisCluster } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MB
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(rateLimit, {
    global: false,
    redis: redisCluster as unknown as Parameters<typeof rateLimit>[1] extends { redis: infer R } ? R : never,
    enableDraftSpec: true,
  });

  redisCluster.on('error', (err: Error) => {
    app.log.error({ err }, 'Redis cluster error');
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, 'Unhandled error');
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
    return reply.status(statusCode).send({
      code: 'INTERNAL_ERROR',
      message: config.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  });

  await app.register(healthRoutes);
  await app.register(ingestRoutes);

  return app;
}
