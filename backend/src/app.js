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
      // Guardian voice notes play back from a blob: URL (fetched audio bytes
      // wrapped in URL.createObjectURL) — without this, mediaSrc falls back
      // to defaultSrc ('self'), which doesn't cover blob:, and playback fails
      // silently (the <audio> element just errors, no console-visible network issue).
      mediaSrc: ["'self'", "blob:"],
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

// CDS document extraction sends base64-encoded files — needs a higher limit
// than the global 64KB. Mount this BEFORE the global parser so the body is
// consumed at the larger limit; the global parser then skips the already-read stream.
app.use("/api/v1/cds/bookings/extract", express.json({
  limit: "20mb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Body parser AFTER rate limit. Capture the raw body so HMAC webhook signature
// checks (e.g. the WhatsApp webhook's X-Hub-Signature-256 verification) can hash
// exactly what was received — express.json otherwise discards it.
app.use(express.json({
  limit: "64kb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
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
  "fuel", "shifts", "traffic"]
  .forEach(r => app.use("/api/v1/" + r, require("./routes/" + r)));

// 4D-geofence corridor writes: POST /api/v1/convoys/:id/corridor (the "Plan
// corridor" button) and GET /api/v1/convoys/:id/corridor/deviations. This router
// was written but never mounted, so planning a corridor 404'd. It MUST stay
// after routes/convoys above, which owns GET /:id/corridor (the live per-device
// evaluation the 4D Geofence page reads); this one only serves the paths
// convoys.js does not define.
try { app.use("/api/v1/convoys", require("./routes/corridors")); logger.info("Route loaded: /api/v1/convoys (corridors)"); }
catch (e) { logger.warn("Corridors route failed: " + e.message); }

try { app.use("/api/v1/guardian/cfo", require("./routes/guardianCfo")); logger.info("Route loaded: /api/v1/guardian/cfo"); }
catch (e) { logger.warn("Guardian CFO route failed: " + e.message); }

try { app.use("/api/v1/guardian/convoy", require("./routes/guardianConvoy")); logger.info("Route loaded: /api/v1/guardian/convoy"); }
catch (err) { logger.error("Failed to load route /api/v1/guardian/convoy: " + err.message); }

// Field app auth (device pairing + per-worker PIN). Entirely separate from
// /api/v1/auth — see routes/field.js and middleware/fieldAuth.js.
try { app.use("/api/v1/field", require("./routes/field")); logger.info("Route loaded: /api/v1/field"); }
catch (e) { logger.warn("Field auth route failed: " + e.message); }

try { app.use("/api/v1/telemetry", require("./routes/telemetry")); logger.info("Route loaded: /api/v1/telemetry (legacy Guardian sync compat)"); }
catch (e) { logger.warn("Telemetry compat route failed: " + e.message); }

try { app.use("/api/v1/guardian/convoy", require("./routes/guardianDayPlan")); logger.info("Route loaded: /api/v1/guardian/convoy (day plans)"); }
catch (err) { logger.error("Failed to load route guardianDayPlan: " + err.message); }

try { app.use("/api/v1/gdpr", require("./routes/gdpr")); logger.info("Route loaded: /api/v1/gdpr"); }
catch (e) { logger.warn("GDPR route failed: " + e.message); }

["drivers", "shipments", "finance", "maintenance", "riskzones", "field-officers"].forEach(r => {
  try { app.use("/api/v1/" + r, require("./routes/" + r)); logger.info("Route loaded: /api/v1/" + r); }
  catch (e) { logger.warn("Route not found: " + r + " — " + e.message); }
});

// Sonalit Mission Control — platform control plane. Every route inside requires
// PLATFORM scope, resolved server-side from platform_admins.
try { app.use("/api/v1/platform", require("./routes/platform")); logger.info("Route loaded: /api/v1/platform (Mission Control)"); }
catch (e) { logger.warn("platform route failed: " + e.message); }

try { app.use("/api/v1/guardian", require("./routes/guardian-ops")); logger.info("Route loaded: guardian-ops"); }
catch (e) { logger.warn("guardian-ops route failed: " + e.message); }

try { app.use("/api/v1/guardian", require("./routes/guardian-knox")); logger.info("Route loaded: guardian-knox"); }
catch (e) { logger.warn("guardian-knox route failed: " + e.message); }

try { app.use("/api/v1/response-crew", require("./routes/response-crew")); logger.info("Route loaded: /api/v1/response-crew"); }
catch (e) { logger.warn("Response crew route failed: " + e.message); }

try { app.use("/api/v1/convoy-handovers", require("./routes/convoyHandover")); logger.info("Route loaded: /api/v1/convoy-handovers"); }
catch (e) { logger.warn("Convoy handover route failed: " + e.message); }

try { app.use("/api/v1/handover-auth", require("./routes/handoverPin")); logger.info("Route loaded: /api/v1/handover-auth"); }
catch (e) { logger.warn("Handover PIN auth route failed: " + e.message); }

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
// broadcast.js (convoy broadcast + WhatsApp webhook/settings/inbound) defines
// absolute paths (/guardian/whatsapp/webhook, /canned-messages, /settings/whatsapp,
// /convoys/:id/broadcast) so it mounts at the /api/v1 root — but BEFORE claims
// below, whose unconditional authenticate would otherwise 401 the unauthenticated
// webhook. It was previously never mounted at all, so the whole feature (and the
// Meta webhook) was dead. Its own /whatsapp/webhook falls through the earlier
// /api/v1/guardian routers (which don't define it) to here.
// Hybrid Tracking. Two routers on purpose: /track is the public, CSRF-exempt
// driver surface authenticated by opaque QR/session tokens, while /tracking is
// the operator + Guardian management surface behind the normal credential.
// Keeping them apart is what stops a scanned QR from ever reaching fleet data.
try { app.use("/api/v1/track", require("./routes/trackingDriver")); logger.info("Route loaded: /api/v1/track (driver)"); }
catch (e) { logger.warn("Driver tracking route failed: " + e.message); }

try { app.use("/api/v1/tracking", require("./routes/tracking")); logger.info("Route loaded: /api/v1/tracking"); }
catch (e) { logger.warn("Tracking route failed: " + e.message); }

try { app.use("/api/v1/cds", require("./routes/cds")); logger.info("Route loaded: /api/v1/cds"); }
catch (e) { logger.warn("CDS route failed: " + e.message); }

try { app.use("/api/v1", require("./routes/broadcast")); logger.info("Route loaded: /api/v1 (broadcast/whatsapp)"); }
catch (e) { logger.warn("Broadcast route failed: " + e.message); }

try { app.use("/api/v1", require("./routes/claims")); logger.info("Route loaded: /api/v1 (claims)"); }
catch (e) { logger.warn("Claims route failed: " + e.message); }

// ─── Public APK download page ────────────────────────────────────────────────
// A phone-friendly install page for Sonalit Guardian, reachable from any device
// at /download — no auth, no GitHub. The button hits /api/v1/guardian/apk/download,
// which redirects to the APK on Cloudflare R2 (or a fallback) via APK_REDIRECT_URL.
app.get("/download/apk", (req, res) => res.redirect(302, "/api/v1/guardian/apk/download"));
function renderDownloadPage() {
  const apk = "/api/v1/guardian/apk/download";
  const info = "/api/v1/guardian/apk/info";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sonalit Guardian — Download</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(1200px 600px at 50% -10%,#152033,#0a0e14 60%); color:#e8ecf1;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:24px; }
  .card { width:100%; max-width:440px; background:linear-gradient(180deg,#111722,#0c1119);
    border:1px solid rgba(255,255,255,.08); border-radius:22px; padding:32px 28px;
    box-shadow:0 24px 70px rgba(0,0,0,.55); text-align:center; }
  .mark { width:60px; height:60px; border-radius:16px; margin:0 auto 18px;
    background:linear-gradient(135deg,#d9a441,#b8801f); display:flex; align-items:center; justify-content:center;
    font-weight:800; font-size:28px; color:#0a0e14; box-shadow:0 8px 24px rgba(200,144,31,.3); }
  h1 { margin:0 0 6px; font-size:23px; letter-spacing:.2px; }
  .sub { margin:0 0 18px; color:#9aa7b6; font-size:14px; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin:0 0 22px; min-height:26px; }
  .chip { font-size:12px; font-weight:600; color:#cbd5e1; background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.08); border-radius:999px; padding:4px 11px; }
  .chip.live { color:#34d399; border-color:rgba(52,211,153,.3); background:rgba(52,211,153,.08); }
  .chip .dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:#34d399;
    margin-right:6px; vertical-align:middle; animation:p 1.8s infinite; }
  @keyframes p { 0%,100%{opacity:1} 50%{opacity:.35} }
  .btn { display:block; width:100%; padding:16px; border-radius:14px; text-decoration:none;
    font-weight:700; font-size:17px; color:#0a0e14; background:linear-gradient(135deg,#e6b455,#c8901f);
    box-shadow:0 8px 24px rgba(200,144,31,.35); }
  .btn:active { transform:translateY(1px); }
  ol { text-align:left; margin:24px 0 0; padding-left:20px; color:#b8c2cf; font-size:13.5px; }
  ol li { margin:8px 0; }
  details { margin-top:18px; text-align:left; }
  details summary { cursor:pointer; color:#9aa7b6; font-size:13px; }
  details pre { white-space:pre-wrap; word-break:break-word; color:#98a6b6; font-size:12px;
    background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); border-radius:10px;
    padding:12px; margin-top:10px; max-height:220px; overflow:auto; }
  .foot { margin-top:22px; font-size:11.5px; color:#5f6b7a; }
</style></head>
<body>
  <div class="card">
    <div class="mark">S</div>
    <h1>Sonalit Guardian</h1>
    <p class="sub">Field officer app · Android 10+</p>
    <div class="meta" id="meta"><span class="chip live"><span class="dot"></span>Always the latest build</span></div>
    <a class="btn" href="${apk}" download>Download APK</a>
    <ol>
      <li>Tap <b>Download APK</b> above.</li>
      <li>Open the downloaded file. If Android warns you, allow <b>Install unknown apps</b> for your browser, then tap <b>Install</b>. Installing over an existing copy keeps your enrolment.</li>
      <li>Open <b>Sonalit Guardian</b> and enter your operator code to enrol.</li>
    </ol>
    <details id="notesWrap" hidden><summary>What's new</summary><pre id="notes"></pre></details>
    <div class="foot">Company-issued devices only. Installing means you accept your organisation's monitoring policy.</div>
  </div>
  <script>
    (function(){
      var meta = document.getElementById('meta');
      function fmtSize(b){ if(!b) return null; var mb=b/1048576; return (mb>=100?Math.round(mb):mb.toFixed(1))+' MB'; }
      function fmtWhen(iso){ if(!iso) return null; var d=new Date(iso); if(isNaN(d)) return null;
        var days=Math.floor((Date.now()-d.getTime())/86400000);
        if(days<=0) return 'updated today'; if(days===1) return 'updated yesterday';
        if(days<30) return 'updated '+days+' days ago';
        return 'updated '+d.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}); }
      function chip(t,live){ var s=document.createElement('span'); s.className='chip'+(live?' live':'');
        if(live){ s.innerHTML='<span class="dot"></span>'; s.appendChild(document.createTextNode(t)); }
        else s.textContent=t; return s; }
      fetch('${info}').then(function(r){return r.json();}).then(function(d){
        meta.innerHTML='';
        meta.appendChild(chip('Latest build',true));
        if(d && d.version) meta.appendChild(chip(String(d.version)));
        var w=d&&fmtWhen(d.published_at); if(w) meta.appendChild(chip(w));
        var s=d&&fmtSize(d.size); if(s) meta.appendChild(chip(s));
        if(d && d.notes){ document.getElementById('notes').textContent=String(d.notes).slice(0,4000);
          document.getElementById('notesWrap').hidden=false; }
      }).catch(function(){ /* keep the default chip; the button still works */ });
    })();
  </script>
</body></html>`;
}

app.get(["/download", "/get"], (req, res) => res.type("html").send(renderDownloadPage()));

// Dedicated download host (get.sonalit.com): serve the install page at the bare
// root so the short link works with no path. Any other host keeps its normal
// behaviour (the API domain's "/" still 404s as before). Railway forwards the
// requested Host, so req.headers.host is the real domain here.
app.get("/", (req, res, next) => {
  const host = String(req.headers.host || "").toLowerCase().split(":")[0];
  const apkHost = (process.env.APK_DOWNLOAD_HOST || "get.sonalit.com").toLowerCase();
  if (host === apkHost || host.startsWith("get.")) return res.type("html").send(renderDownloadPage());
  next();
});

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

// CDS Operations Intelligence: Groq/Llama scans live operational data every 15 min
// and writes alerts for overdue trips, stalled bookings, capacity gaps, etc.
if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test')
try {
  const cron = require("node-cron");
  const { runIntelligenceScan } = require("./utils/cdsIntelligence");
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { rows } = await dbQuery(
        `SELECT DISTINCT org_id FROM cds_trips WHERE deleted_at IS NULL
         UNION SELECT DISTINCT org_id FROM cds_bookings WHERE deleted_at IS NULL LIMIT 50`
      );
      for (const { org_id } of rows) {
        await runIntelligenceScan(dbQuery, org_id);
      }
    } catch (err) { logger.error("CDS intelligence scan error: " + err.message); }
  });
  logger.info("CDS operations intelligence scheduled (*/15 * * * *)");
} catch (e) { logger.warn("CDS intelligence scan not scheduled: " + e.message); }

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
