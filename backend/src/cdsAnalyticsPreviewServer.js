'use strict';

// Dedicated, read-only CDS analytics preview API.
// This entrypoint intentionally does not load app.js, start queue workers,
// register cron jobs, run the intelligence-schema gate, or claim the production
// runtime fence. It exposes one authenticated analytics endpoint plus health.
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middleware/error');
const { pool } = require('./config/database');

const VERCEL_PREVIEW_ORIGIN = /^https:\/\/sonalit-[a-z0-9-]+-onyari-s-projects\.vercel\.app$/i;

function createApp({ cdsRouter, databasePool = pool } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.get('/health', async (_req, res) => {
    try {
      await databasePool.query('SELECT 1');
      res.set('Cache-Control', 'no-store');
      return res.status(200).json({ status: 'ok' });
    } catch (_error) {
      return res.status(503).json({ status: 'unavailable' });
    }
  });

  const corsOptions = {
    origin(origin, callback) {
      // Allow non-browser probes (e.g. Railway health checks) without
      // broadening browser CORS to untrusted origins.
      if (!origin) return callback(null, true);
      return callback(null, VERCEL_PREVIEW_ORIGIN.test(origin));
    },
    credentials: true,
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Field-Device', 'X-Field-Token', 'X-Request-Id'],
    maxAge: 600,
  };
  const cdsCors = cors(corsOptions);

  // Reject every method/path except the single permitted read endpoint before
  // loading the CDS router's authentication/database middleware. The router
  // still enforces JWT/field-auth and org-scoped PostgreSQL access on analytics.
  app.use('/api/v1/cds', (req, res, next) => {
    if (req.path !== '/analytics' || !['GET', 'OPTIONS'].includes(req.method)) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (req.method === 'GET') res.set('Cache-Control', 'no-store');
    return cdsCors(req, res, next);
  }, cdsRouter || require('./routes/cds'));

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use(errorHandler);
  return app;
}

async function start() {
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    throw new Error('CDS analytics preview requires DATABASE_URL and JWT_SECRET');
  }
  const app = createApp();
  const port = Number.parseInt(process.env.PORT || '8080', 10);
  const server = app.listen(port, '0.0.0.0', () => {
    console.info('[cds-analytics-preview] listening; only GET /api/v1/cds/analytics is exposed');
  });

  const shutdown = async () => {
    server.close(async () => {
      try { await pool.end(); } finally { process.exit(0); }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('[cds-analytics-preview] startup failed:', error.message);
    process.exit(1);
  });
}

module.exports = { createApp };
