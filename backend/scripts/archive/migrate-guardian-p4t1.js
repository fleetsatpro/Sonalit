/**
 * Guardian Phase 4 Task 4.1 — FCM push notification support
 *
 * Adds fcm_token column to guardian_devices so devices can register
 * their Firebase Cloud Messaging token at enrollment/heartbeat.
 *
 * Forward-only migration.
 * Rollback: ALTER TABLE guardian_devices DROP COLUMN IF EXISTS fcm_token;
 *           DROP INDEX IF EXISTS idx_guardian_devices_fcm_token;
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[p4t1] Start: add fcm_token to guardian_devices');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS fcm_token TEXT
    `);
    console.log('[p4t1] Added fcm_token TEXT to guardian_devices');

    await client.query('COMMIT');

    // Index outside transaction
    client.release();
    const c2 = await pool.connect();
    try {
      await c2.query(`
        CREATE INDEX IF NOT EXISTS idx_guardian_devices_fcm_token
          ON guardian_devices(fcm_token) WHERE fcm_token IS NOT NULL
      `);
      console.log('[p4t1] Index created');
    } finally {
      c2.release();
    }

    console.log('[p4t1] Done.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[p4t1] FAILED:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
