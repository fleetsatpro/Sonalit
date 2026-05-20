import './otel.js';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { connectNats, closeNats } from './nats.js';
import { loginRoutes } from './routes/login.js';
import { registerRoutes } from './routes/register.js';
import { refreshRoutes } from './routes/refresh.js';
import { passkeysRoutes } from './routes/passkeys.js';
import { totpRoutes } from './routes/totp.js';
import { apikeysRoutes } from './routes/apikeys.js';
import { meRoutes } from './routes/me.js';

const BASE = '/v4/auth';

async function start(): Promise<void> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
  });

  redis.on('error', (err: Error) => { app.log.error({ err }, 'Redis error'); });
  pool.on('error', (err: Error) => { app.log.error({ err }, 'PG pool error'); });

  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    redis,
  });

  app.addHook('preHandler', async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (key && req.method !== 'GET') {
      const { idempotencyHook } = await import('./lib/idempotency.js');
      await idempotencyHook(req, reply);
    }
  });

  await app.register(async (svc) => {
    await loginRoutes(svc);
    await registerRoutes(svc);
    await refreshRoutes(svc);
    await passkeysRoutes(svc);
    await totpRoutes(svc);
    await apikeysRoutes(svc);
    await meRoutes(svc);
  }, { prefix: BASE });

  app.get('/healthz', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return reply.status(200).send({ status: 'ok' });
    } catch {
      return reply.status(503).send({ status: 'degraded' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err, method: req.method, url: req.url }, 'Unhandled error');
    }
    void reply.status(status).send({
      code: (err as { code?: string }).code ?? 'INTERNAL_ERROR',
      message: status < 500 ? err.message : 'Internal server error',
    });
  });

  await connectNats();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'auth-svc listening');

  const shutdown = async (): Promise<void> => {
    app.log.info('Shutting down auth-svc');
    await app.close();
    await closeNats();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}

start().catch((err: Error) => {
  process.stderr.write(`Fatal: ${err.message}\n${err.stack ?? ''}\n`);
  process.exit(1);
});
