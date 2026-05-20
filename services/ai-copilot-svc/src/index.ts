import './otel.js';
import Fastify from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { aiRoutes } from './routes/ai.js';

async function start(): Promise<void> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
    },
  });

  redis.on('error', (err: Error) => {
    app.log.error({ err }, 'Redis error');
  });

  await app.register(healthRoutes);
  await app.register(aiRoutes);

  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, 'Unhandled error');
    void reply.code(500).send({ error: 'Internal server error' });
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'ai-copilot-svc listening');

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Graceful shutdown initiated');
    await app.close();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

start().catch((err: Error) => {
  process.stderr.write(`Fatal startup error: ${err.message}\n`);
  process.exit(1);
});
