import './otel.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { vehiclesRoutes } from './routes/vehicles.js';
import { driversRoutes } from './routes/drivers.js';
import { geofencesRoutes } from './routes/geofences.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { shipmentsRoutes } from './routes/shipments.js';
import { messagesRoutes } from './routes/messages.js';
import { gpsRoutes } from './routes/gps.js';
import { riskZonesRoutes } from './routes/riskzones.js';
import { fieldOfficersRoutes } from './routes/fieldofficers.js';
import { financeRoutes } from './routes/finance.js';

async function start(): Promise<void> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined },
  });

  redis.on('error', (err: Error) => { app.log.error({ err }, 'Redis error'); });

  await app.register(cors, { origin: false });
  await app.register(helmet);
  await app.register(rateLimit, { max: 500, timeWindow: '1 minute' });

  await app.register(healthRoutes);
  await app.register(vehiclesRoutes);
  await app.register(driversRoutes);
  await app.register(geofencesRoutes);
  await app.register(maintenanceRoutes);
  await app.register(shipmentsRoutes);
  await app.register(messagesRoutes);
  await app.register(gpsRoutes);
  await app.register(riskZonesRoutes);
  await app.register(fieldOfficersRoutes);
  await app.register(financeRoutes);

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    app.log.error({ err }, 'Request error');
    void reply.code(status).send({ error: err.message ?? 'Internal server error' });
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info({ port: config.PORT }, 'fleet-svc listening');

  const shutdown = async (sig: string): Promise<void> => {
    app.log.info({ sig }, 'Shutting down');
    await app.close();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

start().catch((err: Error) => { process.stderr.write(`Fatal: ${err.message}\n`); process.exit(1); });
