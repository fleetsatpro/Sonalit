/**
 * Guardian Phase 2 Task 1 — Performance Indexes (CONCURRENTLY)
 *
 * Rollback path:
 *   DROP INDEX CONCURRENTLY IF EXISTS idx_panic_events_device_created;
 *   DROP INDEX CONCURRENTLY IF EXISTS idx_panic_events_active;
 *   DROP INDEX CONCURRENTLY IF EXISTS idx_device_commands_pending;
 *   DROP INDEX CONCURRENTLY IF EXISTS idx_device_commands_sent_at;
 *   DROP INDEX CONCURRENTLY IF EXISTS idx_field_reports_device_created;
 *   DROP INDEX CONCURRENTLY IF EXISTS idx_device_locations_device_ts;
 *   DROP INDEX CONCURRENTLY IF EXISTS idx_guardian_devices_status;
 *
 * NOTE: CONCURRENTLY indexes cannot run inside a transaction block.
 * Each index is created as a separate query call with its own try/catch.
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runQuery(sql) {
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

const indexes = [
  {
    name: 'idx_panic_events_device_created',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_panic_events_device_created
          ON panic_events(device_id, created_at DESC)`,
  },
  {
    name: 'idx_panic_events_active',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_panic_events_active
          ON panic_events(device_id) WHERE resolved_at IS NULL`,
  },
  {
    name: 'idx_device_commands_pending',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_commands_pending
          ON device_commands(device_id, issued_at ASC) WHERE status = 'pending'`,
  },
  {
    name: 'idx_device_commands_sent_at',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_commands_sent_at
          ON device_commands(sent_at) WHERE status = 'sent'`,
  },
  {
    name: 'idx_field_reports_device_created',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_field_reports_device_created
          ON field_reports(device_id, created_at DESC)`,
  },
  {
    name: 'idx_device_locations_device_ts',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_device_locations_device_ts
          ON device_locations(device_id, timestamp DESC)`,
  },
  {
    name: 'idx_guardian_devices_status',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guardian_devices_status
          ON guardian_devices(status) WHERE deleted_at IS NULL`,
  },
];

async function main() {
  console.log('Guardian p2t1: creating performance indexes CONCURRENTLY...');

  for (const idx of indexes) {
    try {
      console.log(`  Creating ${idx.name}...`);
      await runQuery(idx.sql);
      console.log(`  ${idx.name} OK`);
    } catch (err) {
      console.warn(`  WARN: ${idx.name} skipped — ${err.message}`);
    }
  }

  console.log('Guardian p2t1: done.');
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
