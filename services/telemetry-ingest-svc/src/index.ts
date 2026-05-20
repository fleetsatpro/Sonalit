import './otel.js';
import { config } from './config.js';
import { connectNats, closeNats, getJs } from './nats.js';
import { redisCluster } from './redis.js';
import { buildServer } from './server.js';
import { drainBuffer } from './lib/ringBuffer.js';

async function start(): Promise<void> {
  await connectNats();

  const js = getJs();
  await drainBuffer(js);

  const app = await buildServer();

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'telemetry-ingest-svc listening');

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Graceful shutdown initiated');
    await app.close();
    await closeNats();
    await redisCluster.quit();
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

start().catch((err: Error) => {
  process.stderr.write(`Fatal startup error: ${err.message}\n`);
  process.exit(1);
});
