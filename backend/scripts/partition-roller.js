/**
 * Partition roller — runs daily.
 * 1. Creates next month's partition for device_locations and device_health if absent.
 * 2. Drops partitions older than guardian_config.gdpr_retention_days_location (default 90d).
 *
 * Invocation options (pick one):
 *   a) node scripts/partition-roller.js   (Railway cron service, daily at 02:00)
 *   b) Loaded via app.js using node-cron:  require('./scripts/partition-roller')
 *
 * Schedule (Railway): cron expression  0 2 * * *  (02:00 UTC daily)
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TABLES = ['device_locations', 'device_health'];

// Months to keep ahead (create partitions this many months in advance)
const MONTHS_AHEAD = 3;

function monthKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}_${m}`;
}

function monthBounds(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-indexed
  const from = new Date(Date.UTC(y, m, 1));
  const to   = new Date(Date.UTC(y, m + 1, 1));
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

async function getRetentionDays(client) {
  try {
    const row = await client.query(
      `SELECT value_int FROM guardian_config WHERE key = 'gdpr_retention_days_location'`
    );
    return row.rows[0]?.value_int ?? 90;
  } catch (_) { return 90; }
}

async function partitionExists(client, name) {
  const r = await client.query(
    `SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'r'`,
    [name]
  );
  return r.rowCount > 0;
}

async function ensurePartitions(client) {
  const now = new Date();
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const key    = monthKey(target);
    const bounds = monthBounds(target);
    for (const table of TABLES) {
      const partName = `${table}_${key}`;
      if (await partitionExists(client, partName)) continue;
      try {
        await client.query(`
          CREATE TABLE ${partName}
            PARTITION OF ${table}
            FOR VALUES FROM ('${bounds.from}') TO ('${bounds.to}')
        `);
        console.log(`  [roller] Created ${partName} (${bounds.from} → ${bounds.to})`);
      } catch (e) {
        // May already exist if another pod ran concurrently
        if (!e.message.includes('already exists')) throw e;
      }
    }
  }
}

async function dropOldPartitions(client, retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  // List all partitions for our tables
  const r = await client.query(`
    SELECT c.relname AS part_name
    FROM pg_inherits i
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE p.relname = ANY($1)
  `, [TABLES]);

  for (const { part_name } of r.rows) {
    // Extract year_month from name: device_locations_2025_04
    const m = part_name.match(/_(\d{4})_(\d{2})$/);
    if (!m) continue;
    const partEnd = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]), 1)); // start of next month = end of this one
    if (partEnd > cutoff) continue;
    try {
      await client.query(`DROP TABLE IF EXISTS ${part_name}`);
      console.log(`  [roller] Dropped expired partition ${part_name} (ended ${partEnd.toISOString().slice(0,10)})`);
    } catch (e) {
      console.error(`  [roller] Failed to drop ${part_name}: ${e.message}`);
    }
  }
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('[roller] Starting partition maintenance...');
    const retentionDays = await getRetentionDays(client);
    await ensurePartitions(client);
    await dropOldPartitions(client, retentionDays);
    console.log('[roller] Done.');
  } catch (err) {
    console.error('[roller] Error:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

// When run directly (Railway cron or manual): execute and exit.
// When required from app.js for node-cron scheduling: export the function.
if (require.main === module) {
  run();
} else {
  module.exports = { run };
}
