/**
 * Drops the NOT NULL constraint on convoy_trucks.vehicle_id.
 *
 * The original p1 migration created vehicle_id as NOT NULL, but CFO convoys
 * allow truck entries without a linked vehicle (vehicle assigned later).
 * Safe to re-run — ALTER COLUMN DROP NOT NULL is a no-op if already nullable.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { pool } = require('../src/config/database');

async function run() {
  const client = await pool.connect();
  try {
    console.log('[convoy-trucks-fix] Dropping NOT NULL on convoy_trucks.vehicle_id...');
    await client.query(`ALTER TABLE convoy_trucks ALTER COLUMN vehicle_id DROP NOT NULL`);
    console.log('[convoy-trucks-fix] Done');
  } catch (err) {
    if (err.code === '42P01') {
      // Table doesn't exist yet — skip silently (p1 hasn't run)
      console.log('[convoy-trucks-fix] convoy_trucks not found — skipping');
    } else {
      console.error('[convoy-trucks-fix] FAILED:', err.message);
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
