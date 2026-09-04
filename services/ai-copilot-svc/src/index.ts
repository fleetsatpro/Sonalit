import './otel.js';
import Fastify from 'fastify';

import { config } from './config.js';
import { pool } from './db.js';
import { connectNats, closeNats } from './nats.js';
import { redis } from './redis.js';
import { aiRoutes } from './routes/ai.js';
import { commanderRoutes } from './routes/commander.js';
import { healthRoutes } from './routes/health.js';
import { WatchtowerConsumer } from './watchtower/consumer.js';

async function start(): Promise<void> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  redis.on('error', (err: Error) => {
    app.log.error({ err }, 'Redis error');
  });

  await app.register(healthRoutes);
  await app.register(aiRoutes);
  await app.register(commanderRoutes);

  app.setErrorHandler((err, _req, reply) => {
    app.log.error({ err }, 'Unhandled error');
    void reply.code(500).send({ error: 'Internal server error' });
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'ai-copilot-svc listening');

  // Started AFTER the HTTP listener, and never allowed to abort startup:
  // Watchtower augments the platform, so losing event ingestion must not
  // also cost Commander, RAG and the tool registry (Rule 3).
  let watchtower: WatchtowerConsumer | null = null;
  if (config.WATCHTOWER_ENABLED) {
    try {
      const js = await connectNats();
      watchtower = new WatchtowerConsumer({ js, logger: app.log });
      await watchtower.start();
    } catch (err) {
      app.log.error(
        { err },
        'Watchtower could not start; AI plane continues without event ingestion',
      );
      watchtower = null;
    }
  } else {
    app.log.info('Watchtower disabled (set WATCHTOWER_ENABLED=true to consume events)');
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Graceful shutdown initiated');
    await app.close();
    // Correlates whatever is still buffered before the process exits,
    // rather than discarding an in-flight situation.
    await watchtower?.stop();
    await closeNats();
    await redis.quit();
    await pool.end();
    // A service entrypoint is the one place exiting is correct: the
    // shutdown path has completed and there is nothing left to unwind.
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

try {
  await start();
} catch (err) {
  process.stderr.write(`Fatal startup error: ${(err as Error).message}\n`);
  // Startup failed, so there is no server to keep alive; a non-zero exit is
  // what tells the orchestrator to restart or fail the deployment.
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}
