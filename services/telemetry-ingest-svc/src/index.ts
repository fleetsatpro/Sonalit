import './otel.js';
import { config } from './config.js';
import { connectNats, closeNats, isNatsReady } from './nats.js';
import { redisCluster } from './redis.js';
import { buildServer } from './server.js';
import { startOutboxPublisher } from './lib/outboxPublisher.js';
import { pool } from './db.js';

const NATS_RECONNECT_INTERVAL_MS = 5_000;

async function start(): Promise<void> {
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'telemetry-ingest-svc listening');

  const stopOutboxPublisher = startOutboxPublisher();
  let stopping = false;
  let natsAttempt: Promise<void> | null = null;

  const maintainNatsConnection = async (): Promise<void> => {
    if (stopping || natsAttempt) return;
    const attempt = (async (): Promise<void> => {
      if (await isNatsReady()) return;
      try {
        await connectNats();
        app.log.info('NATS JetStream connected; durable telemetry outbox dispatch is active');
      } catch (err) {
        app.log.warn(
          { err },
          'NATS unavailable; telemetry ingestion remains available and accepted GPS fixes stay durably queued in PostgreSQL',
        );
      }
    })();
    natsAttempt = attempt;
    try {
      await attempt;
    } finally {
      if (natsAttempt === attempt) natsAttempt = null;
    }
  };

  // Broker connection is supervised off the request-start path. Repeated
  // attempts also recover after a previously connected client closes.
  void maintainNatsConnection();
  const natsSupervisor = setInterval(() => { void maintainNatsConnection(); }, NATS_RECONNECT_INTERVAL_MS);
  natsSupervisor.unref?.();

  const shutdown = async (signal: string): Promise<void> => {
    stopping = true;
    clearInterval(natsSupervisor);
    app.log.info({ signal }, 'Graceful shutdown initiated');
    if (natsAttempt) await natsAttempt.catch(() => undefined);
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
