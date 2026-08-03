// Main API Server
// Container Delivery System API

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import { Pool } from 'pg';
import { createPool, closePool, testConnection } from '../infrastructure/database/config.js';
import { logger } from '../shared/utils/logger.js';
import { shipmentRoutes } from './routes/shipments.js';

// Environment
const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-min-32-chars-long';

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  trustProxy: true,
});

// Database pool
let pool: Pool;

// Register plugins
async function registerPlugins() {
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  await fastify.register(rateLimit, {
    max: 500,
    timeWindow: '15 minute',
  });

  await fastify.register(formbody);

  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  });

  await fastify.register(jwt, {
    secret: JWT_SECRET,
    sign: {
      expiresIn: '15m',
    },
  });
}

// Register routes
async function registerRoutes() {
  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'container-delivery-system', timestamp: new Date().toISOString() };
  });

  // Mount routes
  await fastify.register(shipmentRoutes, { pool });
}

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error('Request error', {
    error: error.message,
    stack: error.stack,
    url: request.url,
    method: request.method,
  });

  reply.status(error.statusCode || 500).send({
    success: false,
    error: error.message,
  });
});

// Start server
async function start() {
  try {
    // Initialize database
    pool = createPool({} as any);
    
    // Test database connection
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }

    // Register plugins and routes
    await registerPlugins();
    await registerRoutes();

    // Start listening
    await fastify.listen({ port: PORT, host: HOST });
    
    logger.info(`Container Delivery System API running on ${HOST}:${PORT}`);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      await fastify.close();
      await closePool();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

start();

export { fastify, pool };
