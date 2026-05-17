/**
 * Guardian Phase 1 Task 1.5 — Idempotent event submission
 *
 * Forward-only migration.
 * Rollback: DROP INDEX IF EXISTS idx_panic_events_event_uuid;
 *           DROP INDEX IF EXISTS idx_field_reports_event_uuid;
 *           ALTER TABLE panic_events DROP COLUMN IF EXISTS event_uuid;
 *           ALTER TABLE field_reports DROP COLUMN IF EXISTS event_uuid;
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[p1t5] Start: idempotent event submission (event_uuid)');
    await client.query('BEGIN');

    // Step 1: Add nullable event_uuid columns
    await client.query(`
      ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS event_uuid UUID
    `);
    await client.query(`
      ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS event_uuid UUID
    `);
    console.log('[p1t5] Added nullable event_uuid columns');

    // Step 2: Backfill existing rows with generated UUIDs
    await client.query(`
      UPDATE panic_events SET event_uuid = gen_random_uuid() WHERE event_uuid IS NULL
    `);
    await client.query(`
      UPDATE field_reports SET event_uuid = gen_random_uuid() WHERE event_uuid IS NULL
    `);
    console.log('[p1t5] Backfilled event_uuid for existing rows');

    // Step 3: Apply NOT NULL + UNIQUE constraints
    await client.query(`
      ALTER TABLE panic_events ALTER COLUMN event_uuid SET NOT NULL
    `);
    await client.query(`
      ALTER TABLE field_reports ALTER COLUMN event_uuid SET NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_panic_events_event_uuid ON panic_events(event_uuid)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_field_reports_event_uuid ON field_reports(event_uuid)
    `);
    console.log('[p1t5] Applied NOT NULL + UNIQUE constraints');

    await client.query('COMMIT');
    console.log('[p1t5] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[p1t5] FAILED — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
