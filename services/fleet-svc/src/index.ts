import './otel.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { vehicleRoutes } from './routes/vehicles.js';
import { driverRoutes } from './routes/drivers.js';
import { geofenceRoutes } from './routes/geofences.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { shipmentRoutes } from './routes/shipments.js';
import { messagesRoutes } from './routes/messages.js';
import { gpsRoutes } from './routes/gps.js';
import { riskZonesRoutes } from './routes/riskzones.js';
import { fieldOfficersRoutes } from './routes/fieldofficers.js';
import { financeRoutes } from './routes/finance.js';

async function start(): Promise<void> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}) },
  });

  redis.on('error', (err: Error) => { app.log.error({ err }, 'Redis error'); });

  await app.register(cors, { origin: false });
  await app.register(helmet);
  await app.register(rateLimit, { max: 500, timeWindow: '1 minute' });

  await app.register(healthRoutes);
  await app.register(vehicleRoutes);
  await app.register(driverRoutes);
  await app.register(geofenceRoutes);
  await app.register(maintenanceRoutes);
  await app.register(shipmentRoutes);
  await app.register(messagesRoutes);
  await app.register(gpsRoutes);
  await app.register(riskZonesRoutes);
  await app.register(fieldOfficersRoutes);
  await app.register(financeRoutes);

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    app.log.error({ err }, 'Request error');
    void reply.code(status).send({ error: (err as Error).message ?? 'Internal server error' });
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
