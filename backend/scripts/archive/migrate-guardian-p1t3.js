/**
 * Guardian Phase 1 Task 1.3 — Atomic heartbeat command delivery
 *
 * Forward-only migration.
 * Rollback: ALTER TABLE device_commands DROP COLUMN IF EXISTS sent_at;
 *           (Commands currently in 'sent' state would need manual review before rollback.)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[p1t3] Start: add sent_at column to device_commands');
    await client.query('BEGIN');

    // 1. Add sent_at column — records when command was atomically claimed and delivered
    await client.query(`
      ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ
    `);
    console.log('[p1t3] Added sent_at TIMESTAMPTZ to device_commands');

    await client.query('COMMIT');
    console.log('[p1t3] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[p1t3] FAILED — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
