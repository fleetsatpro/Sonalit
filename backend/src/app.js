require("dotenv").config();
const Sentry = require("./instrument");

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
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require("crypto").randomBytes(32).toString("hex");
  logger.warn("JWT_SECRET not set — generated a random one. Set JWT_SECRET in Railway to persist sessions across restarts.");
}

const app = express();
const server = http.createServer(app);
global._server = server;

// ─── Middleware stack (order matters for security) ────────────────────────────
app.use(requestId);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // MapLibre GL fetches raster tiles via fetch()/XHR (not <img> tags), so
      // connect-src — not img-src — is what actually gates tile loading.
      // server.arcgisonline.com (Esri street + satellite tiles) and
      // demotiles.maplibre.org (glyphs) were missing from connect-src, which
      // silently blocked the map from ever rendering.
      connectSrc: ["'self'", "wss://rt.sonalit.io", "https://api.anthropic.com", "https://*.sentry.io", "https://*.openstreetmap.org", "https://server.arcgisonline.com", "https://demotiles.maplibre.org"],
      imgSrc: ["'self'", "data:", "https://*.r2.cloudflarestorage.com", "https://basemaps.cartocdn.com", "https://demotiles.maplibre.org", "https://*.openstreetmap.org", "https://server.arcgisonline.com"],
      workerSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind CSS requires this
      scriptSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
const _corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];
app.use(cors({ origin: _corsOrigins, credentials: true }));
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
app.use(responseEnvelope);
app.use(express.urlencoded({ extended: true }));
app.use(csrf);
app.use(morgan(":method :url :status :res[content-length] - :response-time ms reqId=:req[x-request-id]", { stream: { write: m => logger.info(m.trim()) } }));

// ─── Health & metrics ─────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    const [db, redis] = await Promise.all([dbHealth(), redisHealth()]);
    let partitions_ok = true;
    try {
      const ph = await dbQuery(`SELECT partitions_ok FROM partition_health WHERE partitions_ok = false LIMIT 1`);
      if (ph.rows.length) partitions_ok = false;
    } catch (_) {}
    const mem = process.memoryUsage();
    const status = (db && partitions_ok) ? "ok" : "degraded";
    res.status(db ? 200 : 503).json({
      status,
      database: db ? "ok" : "error",
      redis,
      partitions_ok,
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
    let queueLines = [];
    try {
      const { getQueues } = require("./config/queue");
      const queues = getQueues();
      for (const [name, q] of Object.entries(queues)) {
        if (!q) continue;
        const dead = await q.getFailedCount();
        queueLines.push(
          `# HELP bullmq_dead_jobs Dead jobs in ${name} queue`, `# TYPE bullmq_dead_jobs gauge`,
          `bullmq_dead_jobs{queue="${name}"} ${dead}`
        );
      }
    } catch (_) {}
    const lines = [
      "# HELP process_uptime_seconds Process uptime", "# TYPE process_uptime_seconds counter", "process_uptime_seconds " + uptime,
      "# HELP process_heap_used_bytes V8 heap used", "# TYPE process_heap_used_bytes gauge", "process_heap_used_bytes " + mem.heapUsed,
      "# HELP process_rss_bytes Resident set size", "# TYPE process_rss_bytes gauge", "process_rss_bytes " + mem.rss,
      ...guardianLines,
      ...queueLines,
    ];
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(lines.join("\n") + "\n");
  } catch (e) { res.status(500).send("# error: " + e.message); }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
["auth", "vehicles", "convoys", "alerts", "messages", "analytics", "geofences", "devices",
  "incidents", "rules", "gps", "sensors", "ai", "apikeys", "reports", "documents", "webhooks", "guardian", "realtime", "admin",
  "fuel", "shifts"]
  .forEach(r => app.use("/api/v1/" + r, require("./routes/" + r)));

try { app.use("/api/v1/guardian/cfo", require("./routes/guardianCfo")); logger.info("Route loaded: /api/v1/guardian/cfo"); }
catch (e) { logger.warn("Guardian CFO route failed: " + e.message); }

try { app.use("/api/v1/guardian/convoy", require("./routes/guardianConvoy")); logger.info("Route loaded: /api/v1/guardian/convoy"); }
catch (err) { logger.error("Failed to load route /api/v1/guardian/convoy: " + err.message); }

try { app.use("/api/v1/guardian/convoy", require("./routes/guardianDayPlan")); logger.info("Route loaded: /api/v1/guardian/convoy (day plans)"); }
catch (err) { logger.error("Failed to load route guardianDayPlan: " + err.message); }

try { app.use("/api/v1/gdpr", require("./routes/gdpr")); logger.info("Route loaded: /api/v1/gdpr"); }
catch (e) { logger.warn("GDPR route failed: " + e.message); }

["drivers", "shipments", "finance", "maintenance", "riskzones", "field-officers"].forEach(r => {
  try { app.use("/api/v1/" + r, require("./routes/" + r)); logger.info("Route loaded: /api/v1/" + r); }
  catch (e) { logger.warn("Route not found: " + r + " — " + e.message); }
});

try { app.use("/api/v1/guardian", require("./routes/guardian-ops")); logger.info("Route loaded: guardian-ops"); }
catch (e) { logger.warn("guardian-ops route failed: " + e.message); }

try { app.use("/api/v1/guardian", require("./routes/guardian-knox")); logger.info("Route loaded: guardian-knox"); }
catch (e) { logger.warn("guardian-knox route failed: " + e.message); }

try { app.use("/api/v1/risk", require("./routes/risk")); logger.info("Route loaded: /api/v1/risk"); }
catch (e) { logger.warn("Risk route failed: " + e.message); }

try { app.use("/api/v1/routes", require("./routes/routes")); logger.info("Route loaded: /api/v1/routes"); }
catch (e) { logger.warn("Routes route failed: " + e.message); }

try { app.use("/api/v1/portal/auth", require("./routes/portalAuth")); logger.info("Route loaded: /api/v1/portal/auth"); }
catch(e) { logger.error("Route failed: /api/v1/portal/auth", e); }

try { app.use("/api/v1/portal", require("./routes/portal")); logger.info("Route loaded: /api/v1/portal"); }
catch (e) { logger.warn("Portal route failed: " + e.message); }

try { app.use("/api/v1/dashboard", require("./routes/dashboard")); logger.info("Route loaded: /api/v1/dashboard"); }
catch (e) { logger.warn("Dashboard route failed: " + e.message); }

app.use("/api/v1/sync", (req, res) => res.json({ ok: true, processed: 0 }));

// claims.js defines its own routes as /claims, /claims/:id, /incidents/:id/claims
// (not relative to a /claims mount) so it belongs at the API root — mounting it
// under /api/v1/claims would have doubled the path. It must be mounted LAST,
// after every other /api/v1/* router: claims.js applies `router.use(authenticate,
// attachOrgDb)` unconditionally, and because Express matches app.use() mounts by
// path prefix in registration order, mounting this at the bare /api/v1 root
// anywhere earlier made it swallow every request that fell through an
// earlier-mounted router without a matching route (e.g. any /api/v1/guardian/**
// path the base guardian.js router doesn't own, like /guardian/cfo/login) and
// reject it with 401 "Missing or malformed Authorization header" before it
// could ever reach the router that actually owned that path.
try { app.use("/api/v1", require("./routes/claims")); logger.info("Route loaded: /api/v1 (claims)"); }
catch (e) { logger.warn("Claims route failed: " + e.message); }

app.use((req, res) => res.status(404).json({ error: req.method + " " + req.path + " not found" }));
if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

// ─── Cron jobs ────────────────────────────────────────────────────────────────
if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test')
try {
  const cron = require("node-cron");
  const PARTITION_TABLES = ["gps_logs", "audit_logs", "outbox"];
  async function rollPartitions() {
    for (const t of PARTITION_TABLES) {
      try {
        await dbQuery(`SELECT ensure_future_partitions($1, 3)`, [t]);
        await dbQuery(
          `INSERT INTO partition_health (table_name, checked_at, partitions_ok)
           VALUES ($1, NOW(), true)
           ON CONFLICT (table_name) DO UPDATE SET checked_at = NOW(), partitions_ok = true`,
          [t]
        );
      } catch (err) {
        logger.warn(`Partition roll failed for ${t}: ${err.message}`);
        try {
          await dbQuery(
            `INSERT INTO partition_health (table_name, checked_at, partitions_ok)
             VALUES ($1, NOW(), false)
             ON CONFLICT (table_name) DO UPDATE SET checked_at = NOW(), partitions_ok = false`,
            [t]
          );
        } catch (_) {}
      }
    }
  }
  async function archiveOldPartitions() {
    const { rows } = await dbQuery(`SELECT table_name, retain_months FROM partition_retention`).catch(() => ({ rows: [] }));
    for (const { table_name, retain_months } of rows) {
      try {
        const r = await dbQuery(`SELECT drop_old_partitions($1, $2)`, [table_name, retain_months]);
        const dropped = r.rows[0]?.drop_old_partitions ?? 0;
        if (dropped > 0) logger.info(`Partition archival: dropped ${dropped} old partition(s) for ${table_name}`);
      } catch (err) {
        logger.warn(`Partition archival failed for ${table_name}: ${err.message}`);
      }
    }
  }
  cron.schedule("0 * * * *", () => rollPartitions().catch(err => logger.error("Partition roller error: " + err.message)));
  cron.schedule("0 3 * * *", () => archiveOldPartitions().catch(err => logger.error("Partition archival error: " + err.message)));
  rollPartitions().catch(err => logger.warn("Partition roller startup run: " + err.message));
  logger.info("Partition roller scheduled (hourly, T3.2) + archival (daily 03:00, T6.5)");
} catch (e) { logger.warn("Partition roller not started: " + e.message); }

// T3.7: Photo backfill cron removed — data URI writes are now blocked at the
// boundary and a DB CHECK constraint is in migration 008. Run the backfill
// script manually (node scripts/backfill-base64-photos.js) if legacy rows remain.

if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test')
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

// Risk Intel: refresh risk_zone_stats (materialized view backing GET /api/v1/risk/zones'
// events/events_24h/week_data columns). Postgres never auto-refreshes materialized views,
// and worker.risk.js — written to do exactly this — was never wired to an actual queue or
// started as a process, so the view (and the dashboard reading it) was frozen at whatever
// it computed on creation. Running it in-process here needs no new worker deployment.
if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test')
try {
  const cron = require("node-cron");
  async function refreshRiskZoneStats() {
    await dbQuery("REFRESH MATERIALIZED VIEW CONCURRENTLY risk_zone_stats");
  }
  cron.schedule("*/10 * * * *", () => refreshRiskZoneStats().catch(err => logger.error("Risk zone stats refresh error: " + err.message)));
  refreshRiskZoneStats().catch(err => logger.warn("Risk zone stats startup refresh: " + err.message));
  logger.info("Risk zone stats refresh scheduled (every 10 min)");
} catch (e) { logger.warn("Risk zone stats refresh not scheduled: " + e.message); }

// Risk Intel OSINT sweep: populates risk_events from real-world sources
// (GDELT, ReliefWeb, Claude web search) instead of only manual admin
// entries — see backend/src/utils/riskOsint.js for source details.
if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test')
try {
  const cron = require("node-cron");
  const { runOsintSweep } = require("./utils/riskOsint");
  cron.schedule("0 */2 * * *", () => runOsintSweep().catch(err => logger.error("Risk Intel OSINT sweep error: " + err.message)));
  runOsintSweep().catch(err => logger.warn("Risk Intel OSINT startup sweep: " + err.message));
  logger.info("Risk Intel OSINT sweep scheduled (every 2 hours)");
} catch (e) { logger.warn("Risk Intel OSINT sweep not scheduled: " + e.message); }

// BL-010: GDPR scheduled purge — weekly at 04:00 UTC Sunday
// Executes pending erasure requests older than 30 days.
if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test')
try {
  const cron = require("node-cron");
  cron.schedule("0 4 * * 0", async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const pending = await dbQuery(
        `SELECT id FROM users WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at < $1 LIMIT 100`,
        [cutoff]
      );
      for (const { id } of pending.rows) {
        await dbQuery(
          `UPDATE users SET
             email = 'deleted-' || id || '@purged.invalid',
             name  = '[deleted]',
             deletion_requested_at = NULL,
             deleted_at = NOW()
           WHERE id = $1 AND deleted_at IS NULL`,
          [id]
        );
        await dbQuery(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
        logger.info(`GDPR purge: anonymised user ${id}`);
      }
      if (pending.rows.length) logger.info(`GDPR weekly purge: processed ${pending.rows.length} user(s)`);
    } catch (err) { logger.error("GDPR purge cron error: " + err.message); }
  });
  logger.info("GDPR weekly purge scheduled (Sundays 04:00 UTC, BL-010)");
} catch (e) { logger.warn("GDPR purge cron not started: " + e.message); }

// ─── Start server ─────────────────────────────────────────────────────────────
// GENERATE_OPENAPI=1 skips server.listen so the script can introspect routes safely
// NODE_ENV=test skips listen/queues/cron so integration tests don't collide on port 5000
if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test') {
  const PORT = parseInt(process.env.PORT) || 5000;
  createQueues();
  server.listen(PORT, () => {
    logger.info("FleetOps Enterprise v2.1 running on port " + PORT + " [" + (process.env.NODE_ENV || "development") + "]");
    // Startup schema check — every column touched by POST /auth/login
    dbQuery(`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_name = 'refresh_tokens') AS has_refresh_tokens,
        (SELECT COUNT(*) FROM information_schema.tables
          WHERE table_name = 'partition_health') AS has_partition_health,
        (SELECT COUNT(*) FROM information_schema.routines
          WHERE routine_name = 'ensure_future_partitions') AS has_partition_fn,
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'org_id') AS has_org_id,
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'status') AS has_status,
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'deleted_at') AS has_deleted_at,
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'password_hash') AS has_password_hash,
        (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'deletion_requested_at') AS has_deletion_requested_at
    `).then(r => {
      const c = r.rows[0];
      const missing = [];
      if (c.has_refresh_tokens    === '0') missing.push('refresh_tokens TABLE');
      if (c.has_partition_health  === '0') missing.push('partition_health TABLE');
      if (c.has_partition_fn      === '0') missing.push('ensure_future_partitions FUNCTION');
      if (c.has_org_id            === '0') missing.push('users.org_id');
      if (c.has_status            === '0') missing.push('users.status');
      if (c.has_deleted_at        === '0') missing.push('users.deleted_at');
      if (c.has_password_hash     === '0') missing.push('users.password_hash');
      if (c.has_deletion_requested_at === '0') missing.push('users.deletion_requested_at (GDPR cron)');
      if (missing.length) {
        logger.error('SCHEMA MISSING — login will 500: ' + missing.join(', '));
      } else {
        logger.info('Schema check OK: all login-critical objects present');
      }
    }).catch(e => logger.warn('Startup schema check failed: ' + e.message));
  });
}

if (!process.env.GENERATE_OPENAPI)
  dbQuery(
    `INSERT INTO guardian_config (key, value_int, updated_at) VALUES ('cfo_module_enabled', 1, NOW())
     ON CONFLICT (key) DO UPDATE SET value_int = 1, updated_at = NOW()`
  ).then(() => logger.info("CFO module enabled in DB")).catch(e => logger.warn("CFO module DB flag skipped: " + e.message));

// ─── Workers (in-process only when ENABLE_INPROCESS_WORKERS=true, T3.1) ──────
// In production, workers run as separate processes via worker.*.js entrypoints.
if (process.env.ENABLE_INPROCESS_WORKERS === "true" && process.env.REDIS_URL && process.env.DISABLE_REDIS !== "true") {
  try {
    const { startGPSWorker } = require("./workers/gpsWorker");
    const { startAlertWorker } = require("./workers/alertWorker");
    const { startNotificationWorker } = require("./workers/notificationWorker");
    const { startConvoyReportWorker } = require("./workers/convoyReportWorker");
    const workers = [startGPSWorker(), startAlertWorker(), startNotificationWorker(), ...startConvoyReportWorker()];
    try {
      const { startGuardianWorkers } = require("./workers/worker.guardian");
      const guardianWorkers = startGuardianWorkers();
      workers.push(...guardianWorkers);
    } catch(e) { logger.warn("Guardian workers not started: " + e.message); }
    global._workers = workers;
    logger.info(`Workers started in-process: ${workers.length} active`);
  } catch (e) {
    logger.warn("Worker startup failed: " + e.message + " — continuing without workers");
  }
} else if (process.env.NODE_ENV !== 'test' && !process.env.GENERATE_OPENAPI && (!process.env.ENABLE_INPROCESS_WORKERS || process.env.ENABLE_INPROCESS_WORKERS !== "true")) {
  logger.info("Workers not started in-process — run standalone worker processes (T3.1)");
}

// ─── Convoy report worker — default-on, independent of the gate above ───────
// This repo's Railway config (root railway.json, backend/nixpacks.toml,
// Dockerfile) all deploy a single `npm start` service with no separate
// worker process/service defined anywhere. That means the convoyReport
// BullMQ queue's jobs (checkProgress, generateReport, scheduledRecount) were
// never being consumed at all in that topology — CFO photo uploads worked
// (they write synchronously) and convoy_daily_reports.status correctly
// advanced to 'complete', but it never advanced to 'generated' and pdf_url
// never populated, because that step only happens inside this worker.
//
// Unlike the GPS/alert/notification/guardian workers above (higher-frequency
// or heavier workloads the original design deliberately isolated), this one
// is bursty and lightweight — PDF generation uses pdfkit (no headless
// browser, no image embedding), triggered only on photo upload or an explicit
// regenerate click. Safe to run in the same process by default so a stock
// single-service deploy actually finishes report generation without any
// Railway dashboard changes. Opt out with DISABLE_INPROCESS_CONVOY_REPORT_WORKER=true
// once/if a dedicated worker service is deployed (npm run start:worker:report).
if (
  !global._workers?.length &&
  process.env.REDIS_URL &&
  process.env.DISABLE_REDIS !== "true" &&
  process.env.DISABLE_INPROCESS_CONVOY_REPORT_WORKER !== "true" &&
  process.env.NODE_ENV !== 'test' &&
  !process.env.GENERATE_OPENAPI
) {
  try {
    const { startConvoyReportWorker } = require("./workers/convoyReportWorker");
    global._workers = [...(global._workers || []), ...startConvoyReportWorker()];
    logger.info("Convoy report worker started in-process (default-on; set DISABLE_INPROCESS_CONVOY_REPORT_WORKER=true to opt out)");
  } catch (e) {
    logger.warn("Convoy report worker startup failed: " + e.message + " — reports will not auto-generate");
  }
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

module.exports = { app, server };
