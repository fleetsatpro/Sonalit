require("dotenv").config();
const Sentry = require("./instrument");

// ─── Graceful shutdown ────────────────────────────────────────────────────────
let _shuttingDown = false;
function shutdown(code) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  const log = (() => { try { return require("./utils/logger"); } catch (_) { return console; } })();
  log.info(`Shutdown initiated (code=${code})`);
  const hardExit = setTimeout(() => { log.error("Hard-exit: drain timeout exceeded 10 s"); process.exit(code); }, 10_000).unref();
  (async () => {
    try {
      if (global._server) global._server.close();
      await Promise.all((global._workers || []).map(w => w.close().catch(() => {})));
      const { pool } = require("./config/database");
      await pool.end().catch(() => {});
      clearTimeout(hardExit); process.exit(code);
    } catch (err) { log.error("Error during shutdown: " + err.message); process.exit(code); }
  })();
}
process.on("uncaughtException", err => { try { require("./utils/logger").fatal({ err }, "uncaughtException"); } catch (_) {} shutdown(1); });
process.on("unhandledRejection", reason => { try { require("./utils/logger").fatal({ reason }, "unhandledRejection"); } catch (_) {} shutdown(1); });

const express = require("express");
const http = require("http");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const logger = require("./utils/logger");
const { errorHandler } = require("./middleware/error");
const responseEnvelope = require("./middleware/responseEnvelope");
const { createQueues } = require("./config/queue");
const { healthCheck: dbHealth, query: dbQuery } = require("./config/database");
const { healthCheck: redisHealth } = require("./config/redis");
const requestId = require("./middleware/requestId");
const csrf = require("./middleware/csrf");

if (!process.env.DATABASE_URL) logger.warn("DATABASE_URL not set — set it in Railway so the database works");
if (!process.env.JWT_SECRET) { process.env.JWT_SECRET = require("crypto").randomBytes(32).toString("hex"); logger.warn("JWT_SECRET not set — generated a random one"); }

const app = express();
const server = http.createServer(app);
global._server = server;
app.use(requestId);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    connectSrc: ["'self'", "wss://rt.sonalit.io", "https://api.anthropic.com", "https://*.sentry.io", "https://*.openstreetmap.org", "https://server.arcgisonline.com", "https://demotiles.maplibre.org"],
    imgSrc: ["'self'", "data:", "https://*.r2.cloudflarestorage.com", "https://basemaps.cartocdn.com", "https://demotiles.maplibre.org", "https://*.openstreetmap.org", "https://server.arcgisonline.com"],
    mediaSrc: ["'self'", "blob:"], workerSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], frameAncestors: ["'none'"],
  } }, strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
const _corsOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()) : ['http://localhost:3000', 'http://localhost:5173'];
app.use(cors({ origin: _corsOrigins, credentials: true }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 900000, max: 500, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false }, message: { error: "Too many requests" } }));
const authLoginLimiter = rateLimit({ windowMs: 900000, max: 10, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false }, message: { error: "Too many login attempts" } });
const authRefreshLimiter = rateLimit({ windowMs: 900000, max: 30, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false }, message: { error: "Too many refresh attempts" } });
app.use("/api/v1/auth/login", authLoginLimiter);
app.use("/api/v1/auth/refresh", authRefreshLimiter);
app.use("/api/v1/cds/bookings/extract", express.json({ limit: "20mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.json({ limit: "64kb", verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(responseEnvelope);
app.use(express.urlencoded({ extended: true }));
app.use(csrf);
app.use(morgan(":method :url :status :res[content-length] - :response-time ms reqId=:req[x-request-id]", { stream: { write: m => logger.info(m.trim()) } }));

// Resend must be mounted before authenticated application webhooks. Signature
// verification, not a user session, is the authentication mechanism.
app.use("/api/v1/webhooks/resend", require("./routes/resendWebhook"));

app.get("/health", async (req, res) => {
  try {
    const [db, redis] = await Promise.all([dbHealth(), redisHealth()]);
    const mem = process.memoryUsage();
    res.status(db ? 200 : 503).json({ status: db ? "ok" : "degraded", database: db ? "ok" : "error", redis, uptime_seconds: Math.floor(process.uptime()), version: "2.1.0-enterprise", memory: { heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024), heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024), rss_mb: Math.round(mem.rss / 1024 / 1024) }, node_version: process.version, timestamp: new Date().toISOString() });
  } catch (e) { res.status(503).json({ status: "error", error: e.message }); }
});

app.get("/metrics", async (req, res) => {
  try {
    const mem = process.memoryUsage();
    let queueLines = [];
    try { const { getQueues } = require("./config/queue"); for (const [name, q] of Object.entries(getQueues())) { if (!q) continue; queueLines.push(`# HELP bullmq_failed_jobs Failed jobs in ${name} queue`, `# TYPE bullmq_failed_jobs gauge`, `bullmq_failed_jobs{queue="${name}"} ${await q.getFailedCount()}`); } } catch (_) {}
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(["# HELP process_uptime_seconds Process uptime", "# TYPE process_uptime_seconds counter", `process_uptime_seconds ${Math.floor(process.uptime())}`, "# HELP process_heap_used_bytes V8 heap used", "# TYPE process_heap_used_bytes gauge", `process_heap_used_bytes ${mem.heapUsed}`, "# HELP process_rss_bytes Resident set size", "# TYPE process_rss_bytes gauge", `process_rss_bytes ${mem.rss}`, ...queueLines].join("\n") + "\n");
  } catch (e) { res.status(500).send("# error: " + e.message); }
});

["auth", "vehicles", "convoys", "alerts", "messages", "analytics", "geofences", "devices", "incidents", "rules", "gps", "sensors", "ai", "apikeys", "reports", "documents", "webhooks", "guardian", "realtime", "admin", "fuel", "shifts", "traffic"].forEach(r => app.use("/api/v1/" + r, require("./routes/" + r)));

try { app.use("/api/v1/convoys", require("./routes/corridors")); logger.info("Route loaded: /api/v1/convoys (corridors)"); } catch (e) { logger.warn("Corridors route failed: " + e.message); }
try { app.use("/api/v1/guardian/cfo", require("./routes/guardianCfo")); } catch (e) { logger.warn("Guardian CFO route failed: " + e.message); }
try { app.use("/api/v1/guardian/convoy", require("./routes/guardianConvoy")); } catch (e) { logger.error("Guardian convoy route failed: " + e.message); }
try { app.use("/api/v1/field", require("./routes/field")); } catch (e) { logger.warn("Field route failed: " + e.message); }
try { app.use("/api/v1/telemetry", require("./routes/telemetry")); } catch (e) { logger.warn("Telemetry route failed: " + e.message); }
try { app.use("/api/v1/guardian/convoy", require("./routes/guardianDayPlan")); } catch (e) { logger.error("Guardian day-plan route failed: " + e.message); }
try { app.use("/api/v1/gdpr", require("./routes/gdpr")); } catch (e) { logger.warn("GDPR route failed: " + e.message); }
["drivers", "shipments", "finance", "maintenance", "riskzones", "field-officers"].forEach(r => { try { app.use("/api/v1/" + r, require("./routes/" + r)); } catch (e) { logger.warn(`Route not found: ${r} — ${e.message}`); } });
try { app.use("/api/v1/guardian", require("./routes/guardian-ops")); } catch (e) {}
try { app.use("/api/v1/guardian", require("./routes/guardian-knox")); } catch (e) {}
try { app.use("/api/v1/response-crew", require("./routes/response-crew")); } catch (e) {}
try { app.use("/api/v1/convoy-handovers", require("./routes/convoyHandover")); } catch (e) {}
try { app.use("/api/v1/handover-auth", require("./routes/handoverPin")); } catch (e) {}
try { app.use("/api/v1/risk", require("./routes/risk")); } catch (e) {}

app.use(errorHandler);
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  createQueues();
  server.listen(PORT, () => logger.info(`FleetOps API listening on port ${PORT}`));
}
module.exports = { app, server, shutdown };
