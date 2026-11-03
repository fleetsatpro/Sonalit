import './otel.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { alertRoutes } from './routes/alerts.js';
import { rulesRoutes } from './routes/rules.js';
import { incidentRoutes } from './routes/incidents.js';
import { startGpsConsumer } from './consumers/gps.js';

async function start(): Promise<void> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}) },
  });
  redis.on('error', (err: Error) => { app.log.error({ err }, 'Redis error'); });
  await app.register(cors, { origin: false });
  await app.register(helmet);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(healthRoutes);
  await app.register(alertRoutes);
  await app.register(rulesRoutes);
  await app.register(incidentRoutes);
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    app.log.error({ err }, 'Request error');
    void reply.code(status).send({ error: (err as Error).message ?? 'Internal server error' });
  });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'alerts-svc listening');
  void startGpsConsumer().catch((err: Error) => { app.log.error({ err }, 'GPS consumer crashed'); });
  const shutdown = async (): Promise<void> => {
    await app.close(); await redis.quit(); await pool.end(); process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}
start().catch((err: Error) => { process.stderr.write(`Fatal: ${err.message}\n`); process.exit(1); });
