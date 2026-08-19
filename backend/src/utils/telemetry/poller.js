/**
 * Securisat telemetry poller.
 *
 * The Securysat Fleet API is a REST platform, so we pull rather than wait to be
 * pushed. Once a cycle, for every org that has an enabled telemetry source and
 * whose poll interval is due, fetch current device telemetry, run it through
 * the provider-agnostic ingest core, and write the source's health back so the
 * admin screen can show a real "last synced 8s ago / 12 locks" status instead
 * of a hardcoded "Connected".
 *
 * Entirely inert until SECURISAT_API_KEY is set — a deployment without the
 * integration configured pays nothing for this.
 *
 * Runs off the raw owner pool (like the partition roller in app.js) to read the
 * source list across orgs, then does the actual writes through withOrg so RLS
 * binds per tenant on the ingest path.
 */
const { query } = require('../../config/database');
const { withOrg } = require('../orgScopedDb');
const { ingestBatch } = require('./ingest');
const viasat = require('./viasatAdapter');
const logger = require('../logger');

const PROVIDERS = { securisat: viasat, viasat: viasat };

let running = false;

/**
 * One poll pass. Safe to call on a fixed interval; it self-gates on each
 * source's poll_interval_seconds, so a 15s tick still respects a source
 * configured to poll every 5 minutes. The `running` guard drops a tick that
 * arrives while the previous one is still working rather than overlapping.
 */
async function pollOnce({ now = new Date() } = {}) {
  if (!viasat.isConfigured()) return { skipped: 'not_configured' };
  if (running) return { skipped: 'busy' };
  running = true;
  const summary = { sources: 0, ingested: 0, unknown: 0, errors: 0 };
  try {
    // Due = enabled AND (never polled OR interval elapsed). Evaluated in SQL so
    // a large fleet doesn't pull every source's row into node each tick.
    const due = await query(
      `SELECT id, org_id, provider, external_account_id, base_url, poll_interval_seconds
         FROM cds_telemetry_sources
        WHERE enabled = TRUE
          AND (last_polled_at IS NULL
               OR last_polled_at < $1 - (poll_interval_seconds || ' seconds')::INTERVAL)`,
      [now]
    ).catch((err) => { logger.warn(`telemetry poller: source query failed: ${err.message}`); return { rows: [] }; });

    for (const src of due.rows) {
      summary.sources++;
      const adapter = PROVIDERS[src.provider] || viasat;
      // Stamp the attempt up front so a hang doesn't make this source look
      // permanently due and get hammered every tick.
      await query('UPDATE cds_telemetry_sources SET last_polled_at = NOW(), updated_at = NOW() WHERE id = $1', [src.id])
        .catch(() => {});
      try {
        const samples = await adapter.fetchDeviceTelemetry({
          baseUrl: src.base_url, accountId: src.external_account_id,
        });
        const results = await withOrg(src.org_id, (db) => ingestBatch(db, src.org_id, samples));
        const ingested = results.filter(r => r && r.lock_id && !r.skipped).length;
        const unknown = results.filter(r => r && r.unknown_device).length;
        summary.ingested += ingested;
        summary.unknown += unknown;
        await query(
          `UPDATE cds_telemetry_sources
              SET last_success_at = NOW(), last_error = NULL, devices_seen = $2, updated_at = NOW()
            WHERE id = $1`,
          [src.id, samples.length]
        ).catch(() => {});
      } catch (err) {
        summary.errors++;
        logger.warn(`telemetry poll failed for org ${src.org_id}: ${err.message}`);
        await query('UPDATE cds_telemetry_sources SET last_error = $2, updated_at = NOW() WHERE id = $1',
          [src.id, String(err.message).slice(0, 500)]).catch(() => {});
      }
    }
  } finally {
    running = false;
  }
  return summary;
}

module.exports = { pollOnce };
