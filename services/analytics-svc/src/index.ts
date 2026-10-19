import './otel.js';
import Fastify from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';
import { analyticsErrorHandler } from './lib/errorHandler.js';
import { healthRoutes } from './routes/health.js';
import { analyticsRoutes } from './routes/analytics.js';

async function start(): Promise<void> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  app.setErrorHandler(analyticsErrorHandler);
  await app.register(healthRoutes);
  await app.register(analyticsRoutes);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'analytics-svc listening');
  const shutdown = async (): Promise<void> => { await app.close(); await pool.end(); process.exit(0); };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}
start().catch((err: Error) => { process.stderr.write(`Fatal: ${err.message}\n`); process.exit(1); });
