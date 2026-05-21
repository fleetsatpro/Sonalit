/**
 * Guardian Phase 1 Task 1.7 — panic_active computed by trigger
 *
 * Forward-only migration.
 * Rollback: DROP TRIGGER IF EXISTS trg_panic_events_refresh ON panic_events;
 *           DROP FUNCTION IF EXISTS panic_events_refresh_trigger();
 *           DROP FUNCTION IF EXISTS refresh_panic_active(UUID);
 *           (After rollback, panic_active must be maintained manually or by application code.)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[p1t7] Start: panic_active trigger installation');
    await client.query('BEGIN');

    // 1. Helper function: recompute panic_active for a single device
    await client.query(`
      CREATE OR REPLACE FUNCTION refresh_panic_active(d_id UUID) RETURNS void AS $$
        UPDATE guardian_devices
        SET panic_active = EXISTS (
          SELECT 1 FROM panic_events
          WHERE device_id = d_id AND resolved_at IS NULL
        )
        WHERE id = d_id;
      $$ LANGUAGE SQL
    `);
    console.log('[p1t7] Created refresh_panic_active() function');

    // 2. Trigger function that calls the helper
    await client.query(`
      CREATE OR REPLACE FUNCTION panic_events_refresh_trigger() RETURNS trigger AS $$
      BEGIN
        PERFORM refresh_panic_active(COALESCE(NEW.device_id, OLD.device_id));
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('[p1t7] Created panic_events_refresh_trigger() function');

    // 3. Drop and recreate trigger (idempotent)
    await client.query(`
      DROP TRIGGER IF EXISTS trg_panic_events_refresh ON panic_events
    `);
    await client.query(`
      CREATE TRIGGER trg_panic_events_refresh
      AFTER INSERT OR UPDATE OF resolved_at OR DELETE ON panic_events
      FOR EACH ROW EXECUTE FUNCTION panic_events_refresh_trigger()
    `);
    console.log('[p1t7] Created trigger trg_panic_events_refresh');

    // 4. Backfill panic_active for all existing devices
    const { rowCount } = await client.query(`
      SELECT refresh_panic_active(id) FROM guardian_devices
    `);
    console.log(`[p1t7] Backfilled panic_active for ${rowCount} devices`);

    await client.query('COMMIT');
    console.log('[p1t7] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[p1t7] FAILED — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
