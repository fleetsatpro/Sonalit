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

// Intelligence Collection Fabric: durable, source-aware ingestion into intel_observations.
// Adapters are independently optional and only activate when their credentials/configuration
// are present. The fabric runs more frequently than the heavier risk-zone sweep so fresh
// observations are available for later fusion and analyst products.
if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test')
try {
  const cron = require("node-cron");
  const { runCollectionFabric } = require("./utils/collectionFabric");
  cron.schedule("*/30 * * * *", () => runCollectionFabric().catch(err => logger.error("Intelligence Collection Fabric error: " + err.message)));
  runCollectionFabric().catch(err => logger.warn("Intelligence Collection Fabric startup run: " + err.message));
  logger.info("Intelligence Collection Fabric scheduled (every 30 minutes)");
} catch (e) { logger.warn("Intelligence Collection Fabric not scheduled: " + e.message); }

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

// Sync retention — the change log is a cursor index, not a record, and grows by
// one row per write to a replicated entity. Nightly at 03:40 UTC, offset from
// the 03:00 partition archival so the two are not competing for the same locks.
if (!process.env.GENERATE_OPENAPI && process.env.NODE_ENV !== 'test')
try {
  const cron = require("node-cron");
  const { runRetention } = require("./sync/retention");
  cron.schedule("40 3 * * *", () => {
    runRetention().catch(err => logger.error("Sync retention error: " + err.message));
  });
  logger.info("Sync retention scheduled (daily 03:40 UTC)");
} catch (e) { logger.warn("Sync retention cron not started: " + e.message); }

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