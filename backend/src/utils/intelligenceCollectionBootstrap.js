/*
 * Intelligence Collection Fabric scheduler.
 * Loaded as a Node preload so collection is independent of the legacy Risk
 * Intel cron. Only public/authorized provider adapters are invoked.
 */
require('dotenv').config();
const logger = require('./logger');
const { pool } = require('../config/database');
const { fuseOrg } = require('./intelligenceFusionRuntime');

const DEFAULT_COUNTRIES = [
  'KE','ML','NE','NG','SO','SS','SD','ET','TZ','UG','RW','BF','BI','CM','CF','TD','GH','SN','MZ','ZW',
  'UA','YE','SY','IQ','LB','LY','EG','CO','MX','IN','PK','AF','BD','BJ','CI','TG','HT','MM','PH','PG','VE','SV','GT','HN'
];
let running = false;

function configuredCountries() {
  try {
    const parsed = JSON.parse(process.env.INTEL_COUNTRIES || 'null');
    if (Array.isArray(parsed) && parsed.length) return [...new Set(parsed.map(x => String(x).trim().toUpperCase()).filter(Boolean))].slice(0, 60);
  } catch (_) {}
  return DEFAULT_COUNTRIES;
}

async function runCollection() {
  if (running) return { skipped: true, reason: 'local_run_in_progress' };
  running = true;
  let client;
  let locked = false;
  try {
    client = await pool.connect();
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('sonalit:intelligence:collection')) AS acquired");
    locked = Boolean(lock.rows[0]?.acquired);
    if (!locked) return { skipped: true, reason: 'cluster_run_in_progress' };

    const fabric = require('./intelligenceCollection');
    const { rows: orgs } = await client.query(`SELECT DISTINCT org_id FROM users WHERE org_id IS NOT NULL AND deleted_at IS NULL`);
    const countries = configuredCountries();
    const results = [];

    for (const { org_id: orgId } of orgs) {
      const started = Date.now();
      try {
        const collection = typeof fabric.collectForOrg === 'function' ? await fabric.collectForOrg(orgId, countries) : [];
        const fusion = await fuseOrg(orgId);
        results.push({ org_id: orgId, collection, fusion, duration_ms: Date.now() - started });
        logger.info(`Intelligence Collection Fabric: org=${orgId} completed in ${Date.now() - started}ms`);
      } catch (err) {
        results.push({ org_id: orgId, error: err.message, duration_ms: Date.now() - started });
        logger.warn(`Intelligence Collection Fabric: org=${orgId} failed: ${err.message}`);
      }
    }
    return { countries: countries.length, organizations: results.length, results };
  } catch (err) {
    logger.warn(`Intelligence Collection Fabric scheduler failed: ${err.message}`);
    return { error: err.message };
  } finally {
    if (client && locked) { try { await client.query("SELECT pg_advisory_unlock(hashtext('sonalit:intelligence:collection'))"); } catch (_) {} }
    try { client?.release(); } catch (_) {}
    running = false;
  }
}

if (process.env.NODE_ENV !== 'test' && process.env.GENERATE_OPENAPI !== '1') {
  const intervalMs = Math.max(5, Number(process.env.INTEL_COLLECTION_INTERVAL_MINUTES || 30)) * 60 * 1000;
  setTimeout(() => runCollection().catch(() => {}), 20_000).unref();
  setInterval(() => runCollection().catch(() => {}), intervalMs).unref();
  logger.info(`Intelligence Collection Fabric scheduled (${Math.round(intervalMs / 60000)} min; public/authorized sources only)`);
}
module.exports = { runCollection };
