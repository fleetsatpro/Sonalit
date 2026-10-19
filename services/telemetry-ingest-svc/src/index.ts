import './otel.js';
import { config } from './config.js';
import { connectNats, closeNats, getJs } from './nats.js';
import { redisCluster } from './redis.js';
import { buildServer } from './server.js';
import { startOutboxPublisher } from './lib/outboxPublisher.js';
import { pool } from './db.js';

async function start(): Promise<void> {
  await connectNats();

  getJs(); // Fail startup if NATS is unavailable.
  const stopOutboxPublisher = startOutboxPublisher();
  const app = await buildServer();

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'telemetry-ingest-svc listening');

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Graceful shutdown initiated');
    await stopOutboxPublisher();
    await app.close();
    await closeNats();
    await redisCluster.quit();
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
