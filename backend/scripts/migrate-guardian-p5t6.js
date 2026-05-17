/**
 * Guardian Phase 5 Task 5.6 — Multi-tenancy foundation
 *
 * Adds org_id column to guardian_devices and guardian_config.
 * Also adds org_id column to panic_events and field_reports so per-org
 * RLS policies can be added later without a rewrite.
 *
 * Forward-only migration.
 * Rollback:
 *   ALTER TABLE guardian_devices DROP COLUMN IF EXISTS org_id;
 *   ALTER TABLE panic_events DROP COLUMN IF EXISTS org_id;
 *   ALTER TABLE field_reports DROP COLUMN IF EXISTS org_id;
 *   ALTER TABLE guardian_config DROP COLUMN IF EXISTS org_id;
 *   DROP INDEX IF EXISTS idx_guardian_devices_org;
 *   DROP INDEX IF EXISTS idx_panic_events_org;
 *   DROP INDEX IF EXISTS idx_field_reports_org;
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[p5t6] Start: multi-tenancy org_id columns');
    await client.query('BEGIN');

    // Add org_id to guardian_devices
    await client.query(`
      ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS org_id UUID
    `);
    console.log('[p5t6] Added org_id to guardian_devices');

    // Add org_id to panic_events
    await client.query(`
      ALTER TABLE panic_events ADD COLUMN IF NOT EXISTS org_id UUID
    `);
    console.log('[p5t6] Added org_id to panic_events');

    // Add org_id to field_reports
    await client.query(`
      ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS org_id UUID
    `);
    console.log('[p5t6] Added org_id to field_reports');

    // Add org_id to guardian_config for per-org overrides
    await client.query(`
      ALTER TABLE guardian_config ADD COLUMN IF NOT EXISTS org_id UUID
    `);
    console.log('[p5t6] Added org_id to guardian_config');

    await client.query('COMMIT');

    // Indexes outside transaction (CONCURRENTLY requires autocommit)
    client.release();

    const client2 = await pool.connect();
    try {
      // Non-concurrent indexes (table is likely small at migration time)
      await client2.query(`
        CREATE INDEX IF NOT EXISTS idx_guardian_devices_org
          ON guardian_devices(org_id) WHERE org_id IS NOT NULL
      `);
      await client2.query(`
        CREATE INDEX IF NOT EXISTS idx_panic_events_org
          ON panic_events(org_id) WHERE org_id IS NOT NULL
      `);
      await client2.query(`
        CREATE INDEX IF NOT EXISTS idx_field_reports_org
          ON field_reports(org_id) WHERE org_id IS NOT NULL
      `);
      console.log('[p5t6] Indexes created');
    } finally {
      client2.release();
    }

    console.log('[p5t6] Done.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[p5t6] FAILED:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
