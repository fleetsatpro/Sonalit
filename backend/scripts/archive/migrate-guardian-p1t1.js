/**
 * Guardian Phase 1 Task 1.1 — wipe_cache removal + guardian_config bootstrap
 *
 * Forward-only migration.
 * Rollback: UPDATE device_commands SET command_type='wipe_cache'
 *           WHERE command_type='restart_agent' AND executed_at IS NULL
 *           AND issued_at > '<migration timestamp>';
 *           (Full rollback impossible after execution if commands were already executed.)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[p1t1] Start: wipe_cache removal + guardian_config bootstrap');
    await client.query('BEGIN');

    // 1. guardian_config table (key/value store for server-side feature flags)
    await client.query(`
      CREATE TABLE IF NOT EXISTS guardian_config (
        key         TEXT PRIMARY KEY,
        value_int   INT,
        value_text  TEXT,
        description TEXT,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 2. Seed initial min_apk_version_code = 3 (current production versionCode).
    //    Set to 3 so no enrolled device is blocked on day one.
    await client.query(`
      INSERT INTO guardian_config (key, value_int, description)
      VALUES ('min_apk_version_code', 3, 'Heartbeat rejects APKs below this versionCode with HTTP 426')
      ON CONFLICT (key) DO NOTHING
    `);

    // 3. Migrate existing wipe_cache commands → restart_agent.
    //    Both have identical runtime behaviour (kill process); restart_agent is the canonical name.
    const { rowCount } = await client.query(`
      UPDATE device_commands
      SET command_type = 'restart_agent'
      WHERE command_type = 'wipe_cache'
    `);
    console.log(`[p1t1] Migrated ${rowCount} device_commands wipe_cache → restart_agent`);

    await client.query('COMMIT');
    console.log('[p1t1] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[p1t1] FAILED — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
