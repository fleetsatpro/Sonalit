require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');

const logger = require('./utils/logger');
const { healthCheck: dbHealth } = require('./config/database');
const { healthCheck: redisHealth } = require('./config/redis');
const { createQueues } = require('./config/queue');
const { errorHandler } = require('./middleware/error');
const { setIO: gpsSetIO } = require('./workers/gpsWorker');
const { setIO: alertSetIO } = require('./workers/alertWorker');

// Validate required env vars at startup
['JWT_SECRET', 'DATABASE_URL'].forEach((key) => {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
});

const app = express();
const server = http.createServer(app);

// ── Socket.IO ──────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: function(origin, callback) { const allowed = [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000']; if (!origin || allowed.includes(origin) || origin.endsWith('.vercel.app')) { callback(null, true); } else { callback(new Error('Not allowed by CORS')); } }, credentials: true },
  transports: ['websocket', 'polling'],
});

// JWT auth on socket handshake
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id} user=${socket.user?.email}`);

  socket.on('subscribe:region', (region) => {
    socket.join(`region:${region}`);
    logger.info(`Socket ${socket.id} joined region:${region}`);
  });

  socket.on('disconnect', () => logger.info(`Socket disconnected: ${socket.id}`));
});

// Share io instance with route handlers and workers
app.set('io', io);
gpsSetIO(io);
alertSetIO(io);

// ── Middleware ─────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: function(origin, callback) { const allowed = [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000']; if (!origin || allowed.includes(origin) || origin.endsWith('.vercel.app')) { callback(null, true); } else { callback(new Error('Not allowed by CORS')); } }, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  validate: { xForwardedForHeader: false },
  legacyHeaders: false,
  message: { error: 'Too many requests — try again in 15 minutes' },
}));

// ── Health ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const [db, redis] = await Promise.all([dbHealth(), redisHealth()]);
    res.json({
      status: 'ok',
      database: db ? 'ok' : 'error',
      redis,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ── Routes ─────────────────────────────────────────────────────────────
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/vehicles', require('./routes/vehicles'));
app.use('/api/v1/convoys', require('./routes/convoys'));
app.use('/api/v1/alerts', require('./routes/alerts'));
app.use('/api/v1/messages', require('./routes/messages'));
app.use('/api/v1/analytics', require('./routes/analytics'));
app.use('/api/v1/geofences', require('./routes/geofences'));
app.use('/api/v1/devices', require('./routes/devices'));
app.use('/api/v1/incidents', require('./routes/incidents'));
app.use('/api/v1/rules', require('./routes/rules'));
app.use('/api/v1/geofences', require('./routes/geofences'));
app.use('/api/gps', require('./routes/gps'));

// 404
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));

// Global error handler
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000;

async function start() {
  // Initialise queues
  createQueues();

  server.listen(PORT, () => {
    logger.info(`FleetOps API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      logger.info('HTTP server closed');
      try {
        const { pool } = require('./config/database');
        await pool.end();
        logger.info('Database pool closed');
      } catch {}
      process.exit(0);
    });
    setTimeout(() => { logger.error('Shutdown timeout — forcing exit'); process.exit(1); }, 10000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => { logger.error(`Startup error: ${err.message}`); process.exit(1); });

module.exports = { app, server, io };
