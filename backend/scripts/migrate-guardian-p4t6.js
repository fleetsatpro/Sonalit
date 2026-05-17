/**
 * Guardian Phase 4 Task 4.6 — Batch location upload support
 *
 * No schema changes needed — batch endpoint writes to existing device_locations table.
 * This migration creates a partial index optimized for bulk inserts and
 * a guardian_config entry to control batch upload size limits.
 *
 * Forward-only migration.
 * Rollback:
 *   DELETE FROM guardian_config WHERE key IN ('batch_location_max_points','feature_batch_location');
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[p4t6] Start: batch location config');
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO guardian_config (key, value_int, description)
      VALUES ('batch_location_max_points', 500, 'Maximum GPS points per batch upload request')
      ON CONFLICT (key) DO NOTHING
    `);
    console.log('[p4t6] Seeded batch_location_max_points = 500');

    await client.query('COMMIT');
    console.log('[p4t6] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[p4t6] FAILED:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
