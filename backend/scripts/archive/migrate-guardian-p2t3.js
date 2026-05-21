/**
 * Guardian Phase 2 Task 3 — Command expiry column
 *
 * Rollback path:
 *   ALTER TABLE device_commands DROP COLUMN IF EXISTS expires_at;
 *   (The UPDATE to set values on existing rows cannot be undone; only the
 *    column itself can be removed. Data change is non-destructive — it only
 *    adds expiry timestamps to previously-NULL rows.)
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Guardian p2t3: adding expires_at to device_commands...');

    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
    `);

    const result = await client.query(`
      UPDATE device_commands
      SET expires_at = issued_at + INTERVAL '24 hours'
      WHERE expires_at IS NULL AND status IN ('pending', 'sent')
    `);
    console.log(`  Back-filled expires_at on ${result.rowCount} existing commands`);

    await client.query('COMMIT');
    console.log('Guardian p2t3: done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Guardian p2t3: failed, rolled back.', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
