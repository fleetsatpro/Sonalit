/**
 * Server-side retention for the sync tables.
 *
 * The change log is the only table here that grows without bound — one row per
 * write to a replicated entity, forever. It is a cursor index, not a record: a
 * device that has been dark longer than the retention window cannot use it
 * anyway and must re-bootstrap, which the pull path already handles because a
 * checkpoint below the oldest surviving seq simply returns everything that is
 * left.
 *
 * The operation ledger is NOT pruned on the same schedule. It is the audit
 * trail for field work — who recorded what, on which device, and what the
 * server decided — and it is also what makes a late retry idempotent. Pruning
 * it early would turn a delayed duplicate into a second business transaction,
 * which is the exact failure this whole subsystem exists to prevent. It is kept
 * far longer than any plausible offline stretch, and unresolved conflicts are
 * never pruned at all.
 */
const { query } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Days of change-log history to keep. A device offline longer than this
 * re-bootstraps from checkpoint 0 rather than resuming.
 */
const CHANGE_LOG_DAYS = Number(process.env.SYNC_CHANGE_LOG_RETENTION_DAYS || 30);

/**
 * Days of operation-ledger history to keep. Must comfortably exceed the longest
 * offline stretch a device could plausibly survive, because a retry arriving
 * after its ledger row is gone would be applied a second time.
 */
const OPERATION_DAYS = Number(process.env.SYNC_OPERATION_RETENTION_DAYS || 180);

/** Delete in bounded chunks so a first run on a large table cannot lock it up. */
const CHUNK = 10_000;

/**
 * These are system-level maintenance deletes across every tenant, so they use
 * the global pool deliberately — there is no request, no org context, and
 * running them per-org would mean enumerating tenants to do the same work.
 * They touch only sync-internal tables and never read tenant data out.
 */
async function pruneChangeLog(days = CHANGE_LOG_DAYS) {
  let removed = 0;
  for (;;) {
    const res = await query(
      `DELETE FROM sync_change_log
        WHERE seq IN (
          SELECT seq FROM sync_change_log
           WHERE changed_at < NOW() - ($1 || ' days')::interval
           LIMIT $2
        )`,
      [String(days), CHUNK]
    );
    removed += res.rowCount;
    if (res.rowCount < CHUNK) break;
  }
  return removed;
}

async function pruneOperations(days = OPERATION_DAYS) {
  let removed = 0;
  for (;;) {
    const res = await query(
      `DELETE FROM sync_operations
        WHERE ctid IN (
          SELECT ctid FROM sync_operations
           WHERE server_received_at < NOW() - ($1 || ' days')::interval
             AND status <> 'claimed'
           LIMIT $2
        )`,
      [String(days), CHUNK]
    );
    removed += res.rowCount;
    if (res.rowCount < CHUNK) break;
  }
  return removed;
}

async function runRetention() {
  const changes = await pruneChangeLog();
  const ops = await pruneOperations();
  if (changes || ops) {
    logger.info(`sync retention: pruned ${changes} change-log rows, ${ops} operation rows`);
  }
  return { changes, ops };
}

module.exports = { runRetention, pruneChangeLog, pruneOperations, CHANGE_LOG_DAYS, OPERATION_DAYS };
