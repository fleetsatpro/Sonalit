require("dotenv").config();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// shutdown(code): stop accepting traffic, drain workers, close pool, then exit.
// Hard-exits after 10 s if normal drain takes too long.
let _shuttingDown = false;
function shutdown(code) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  const log = (() => { try { return require("./utils/logger"); } catch (_) { return console; } })();
  log.info(`Shutdown initiated (code=${code})`);

  const hardExit = setTimeout(() => {
    log.error("Hard-exit: drain timeout exceeded 10 s");
    process.exit(code);
  }, 10_000).unref();

  (async () => {
    try {
      if (global._server) global._server.close();
      const workers = global._workers || [];
      await Promise.all(workers.map(w => w.close().catch(() => {})));
      const { pool } = require("./config/database");
      await pool.end().catch(() => {});
      clearTimeout(hardExit);
      process.exit(code);
    } catch (err) {
      log.error("Error during shutdown: " + err.message);
      process.exit(code);
    }
  })();
}

process.on("uncaughtException", (err) => {
  try { require("./utils/logger").fatal({ err }, "uncaughtException"); } catch (_) { console.error("uncaughtException:", err); }
  shutdown(1);
});
process.on("unhandledRejection", (reason) => {
  try { require("./utils/logger").fatal({ reason }, "unhandledRejection"); } catch (_) { console.error("unhandledRejection:", reason); }
  shutdown(1);
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const jwt = require("jsonwebtoken");

const logger = require("./utils/logger");
const { errorHandler } = require("./middleware/error");
const { setIO: gpsSetIO } = require("./workers/gpsWorker");
const { setIO: alertSetIO } = require("./workers/alertWorker");
const { createQueues } = require("./config/queue");
const { healthCheck: dbHealth, query: dbQuery } = require("./config/database");
const { healthCheck: redisHealth } = require("./config/redis");
const requestId = require("./middleware/requestId");

if (!process.env.DATABASE_URL) logger.warn("DATABASE_URL not set — set it in Railway so the database works");
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require("crypto").randomBytes(32).toString("hex");
  logger.warn("JWT_SECRET not set — generated a random one. Set JWT_SECRET in Railway to persist sessions across restarts.");
}

const app = express();
const server = http.createServer(app);
global._server = server;

const io = new Server(server, { cors: { origin: true, credentials: true }, transports: ["websocket", "polling"] });

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error("Auth required"));
  try { socket.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { next(new Error("Invalid token")); }
});

io.on("connection", s => {
  logger.info("Socket: " + s.id + " user=" + s.user?.email);
  s.on("subscribe:region", r => s.join("region:" + r));
  s.on("subscribe:convoy", id => s.join("convoy:" + id));
  s.on("subscribe:device", id => s.join("device:" + id));
  s.on("disconnect", () => logger.info("Socket disconnected: " + s.id));
});

// Socket.IO Redis adapter for horizontal scaling
if (process.env.REDIS_URL) {
  try {
    const { createAdapter } = require("@socket.io/redis-adapter");
    const Redis = require("ioredis");
    const pubClient = new Redis(process.env.REDIS_URL);
    const subClient = pubClient.duplicate();
    pubClient.on("error", e => logger.warn("Socket.IO Redis pub error: " + e.message));
    subClient.on("error", e => logger.warn("Socket.IO Redis sub error: " + e.message));
    io.adapter(createAdapter(pubClient, subClient));
    logger.info("Socket.IO Redis adapter active");
  } catch (e) { logger.warn("Socket.IO Redis adapter failed: " + e.message); }
}

app.set("io", io);
gpsSetIO(io);
alertSetIO(io);

// ─── Middleware stack (order matters for security) ────────────────────────────
app.use(requestId);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "wss://rt.sonalit.io", "https://api.anthropic.com", "https://*.sentry.io"],
      imgSrc: ["'self'", "data:", "https://*.r2.cloudflarestorage.com", "https://basemaps.cartocdn.com", "https://demotiles.maplibre.org"],
      workerSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind CSS requires this
      scriptSrc: ["'self'"],
    },
  },
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// ── Global IP rate-limit BEFORE body parsing so large-body attacks are blocked
// before consuming memory (T1.8)
app.use(rateLimit({
  windowMs: 900_000, // 15 min
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: "Too many requests" },
}));

// Per-route tighter limits mounted on specific paths (T1.8)
const authLoginLimiter = rateLimit({ windowMs: 900_000, max: 10, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false }, message: { error: "Too many login attempts" } });
const authRefreshLimiter = rateLimit({ windowMs: 900_000, max: 30, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false }, message: { error: "Too many refresh attempts" } });

app.use("/api/v1/auth/login", authLoginLimiter);
app.use("/api/v1/auth/refresh", authRefreshLimiter);

// Body parser AFTER rate limit
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(":method :url :status :res[content-length] - :response-time ms reqId=:req[x-request-id]", { stream: { write: m => logger.info(m.trim()) } }));

// ─── Health & metrics ─────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    const [db, redis] = await Promise.all([dbHealth(), redisHealth()]);
    const mem = process.memoryUsage();
    res.status(200).json({
      status: db ? "ok" : "degraded",
      database: db ? "ok" : "error",
      redis,
      uptime_seconds: Math.floor(process.uptime()),
      version: "2.1.0-enterprise",
      memory: { heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024), heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024), rss_mb: Math.round(mem.rss / 1024 / 1024) },
      node_version: process.version,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    });
  } catch (e) { res.status(503).json({ status: "error", error: e.message }); }
});

app.get("/metrics", async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const uptime = Math.floor(process.uptime());
    let guardianLines = [];
    try {
      const [devices, panics] = await Promise.all([
        dbQuery("SELECT COUNT(*) AS n FROM guardian_devices WHERE deleted_at IS NULL AND status='active'"),
        dbQuery("SELECT COUNT(*) AS n FROM panic_events WHERE resolved_at IS NULL"),
      ]);
      guardianLines = [
        "# HELP guardian_devices_active Active guardian devices", "# TYPE guardian_devices_active gauge",
        "guardian_devices_active " + devices.rows[0].n,
        "# HELP guardian_panics_active Unresolved panic events", "# TYPE guardian_panics_active gauge",
        "guardian_panics_active " + panics.rows[0].n,
      ];
    } catch (_) {}
    const lines = [
      "# HELP process_uptime_seconds Process uptime", "# TYPE process_uptime_seconds counter", "process_uptime_seconds " + uptime,
      "# HELP process_heap_used_bytes V8 heap used", "# TYPE process_heap_used_bytes gauge", "process_heap_used_bytes " + mem.heapUsed,
      "# HELP process_rss_bytes Resident set size", "# TYPE process_rss_bytes gauge", "process_rss_bytes " + mem.rss,
      ...guardianLines,
    ];
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines.join("\n") + "\n");
  } catch (e) { res.status(500).send("# error: " + e.message); }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
["auth", "vehicles", "convoys", "alerts", "messages", "analytics", "geofences", "devices",
  "incidents", "rules", "gps", "sensors", "ai", "apikeys", "reports", "documents", "webhooks", "guardian"]
  .forEach(r => app.use("/api/v1/" + r, require("./routes/" + r)));

try { app.use("/api/v1/guardian/cfo", require("./routes/guardianCfo")); logger.info("Route loaded: /api/v1/guardian/cfo"); }
catch (e) { logger.warn("Guardian CFO route failed: " + e.message); }

try { app.use("/api/v1/gdpr", require("./routes/gdpr")); logger.info("Route loaded: /api/v1/gdpr"); }
catch (e) { logger.warn("GDPR route failed: " + e.message); }

["drivers", "shipments", "finance", "maintenance", "riskzones"].forEach(r => {
  try { app.use("/api/v1/" + r, require("./routes/" + r)); logger.info("Route loaded: /api/v1/" + r); }
  catch (e) { logger.warn("Route not found: " + r + " — " + e.message); }
});

app.use("/api/v1/sync", (req, res) => res.json({ ok: true, processed: 0 }));
app.use((req, res) => res.status(404).json({ error: req.method + " " + req.path + " not found" }));
app.use(errorHandler);

// ─── Cron jobs ────────────────────────────────────────────────────────────────
try {
  const cron = require("node-cron");
  const { run: rollPartitions } = require("../scripts/partition-roller");
  cron.schedule("0 2 * * *", () => rollPartitions().catch(err => logger.error("Partition roller error: " + err.message)));
  rollPartitions().catch(err => logger.warn("Partition roller startup run: " + err.message));
  logger.info("Partition roller scheduled (daily 02:00 UTC)");
} catch (e) { logger.warn("Partition roller not started: " + e.message); }

try {
  const cron = require("node-cron");
  const { run: backfillPhotos } = require("../scripts/backfill-base64-photos");
  cron.schedule("0 3 * * *", () => backfillPhotos().catch(err => logger.error("Photo backfill error: " + err.message)));
  logger.info("Photo backfill scheduled (daily 03:00 UTC)");
} catch (e) { logger.warn("Photo backfill not scheduled: " + e.message); }

try {
  const cron = require("node-cron");
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { isCfoModuleEnabled } = require("./utils/cfoFlag");
      if (!await isCfoModuleEnabled()) return;
      const { getQueues } = require("./config/queue");
      const { convoyReportQueue } = getQueues();
      if (!convoyReportQueue) return;
      const result = await dbQuery(
        `SELECT cdr.convoy_id, cdr.report_date::text, c.timezone
         FROM convoy_daily_reports cdr JOIN convoys c ON c.id = cdr.convoy_id
         WHERE c.status = 'active' AND c.deleted_at IS NULL
           AND cdr.status IN ('complete', 'partial') AND cdr.pdf_url IS NULL
           AND (cdr.report_date < CURRENT_DATE
             OR (cdr.report_date = CURRENT_DATE
               AND NOW() AT TIME ZONE COALESCE(c.timezone,'UTC') > (cdr.report_date + INTERVAL '1 day')::timestamptz AT TIME ZONE COALESCE(c.timezone,'UTC')))`,
        []
      );
      for (const row of result.rows) {
        await convoyReportQueue.add("generateReport", { convoy_id: row.convoy_id, report_date: row.report_date },
          { jobId: `genReport:${row.convoy_id}:${row.report_date}`, removeOnComplete: { count: 200 } });
      }
      if (result.rows.length) logger.info(`EOD sweep: queued ${result.rows.length} generateReport jobs`);
    } catch (err) { logger.error("EOD finalization sweep error: " + err.message); }
  });
  logger.info("CFO EOD finalization sweep scheduled (*/15 * * * *)");
} catch (e) { logger.warn("CFO EOD sweep not scheduled: " + e.message); }

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000;
createQueues();
server.listen(PORT, () => logger.info("FleetOps Enterprise v2.1 running on port " + PORT + " [" + (process.env.NODE_ENV || "development") + "]"));

dbQuery(
  `INSERT INTO guardian_config (key, value_int, updated_at) VALUES ('cfo_module_enabled', 1, NOW())
   ON CONFLICT (key) DO UPDATE SET value_int = 1, updated_at = NOW()`
).then(() => logger.info("CFO module enabled in DB")).catch(e => logger.warn("CFO module DB flag skipped: " + e.message));

// ─── Workers ──────────────────────────────────────────────────────────────────
if (process.env.REDIS_URL && process.env.DISABLE_REDIS !== "true") {
  try {
    const { startGPSWorker } = require("./workers/gpsWorker");
    const { startAlertWorker } = require("./workers/alertWorker");
    const { startNotificationWorker } = require("./workers/notificationWorker");
    const { startConvoyReportWorker } = require("./workers/convoyReportWorker");
    const workers = [startGPSWorker(), startAlertWorker(), startNotificationWorker(), ...startConvoyReportWorker()];
    global._workers = workers;
    logger.info(`Workers started in-process: ${workers.length} active`);
    process.on("SIGTERM", () => shutdown(0));
    process.on("SIGINT", () => shutdown(0));
  } catch (e) {
    logger.warn("Worker startup failed: " + e.message + " — continuing without workers");
    process.on("SIGTERM", () => shutdown(0));
    process.on("SIGINT", () => shutdown(0));
  }
} else {
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
}

module.exports = { app, server, io };
