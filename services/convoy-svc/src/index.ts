import './otel.js';
import Fastify from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { convoysRoutes } from './routes/convoys.js';

async function start(): Promise<void> {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  redis.on('error', (err: Error) => { app.log.error({ err }, 'Redis error'); });
  await app.register(healthRoutes);
  await app.register(convoysRoutes);
  app.setErrorHandler((err, _req, reply) => { void reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message }); });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'convoy-svc listening');
  const shutdown = async (): Promise<void> => { await app.close(); await redis.quit(); await pool.end(); process.exit(0); };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}
start().catch((err: Error) => { process.stderr.write(`Fatal: ${err.message}\n`); process.exit(1); });
