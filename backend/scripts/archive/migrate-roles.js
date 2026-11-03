/**
 * Extend users.role CHECK constraint to include 'driver' and 'cfo'.
 * Safe to re-run — uses DROP IF EXISTS before re-adding.
 */
require('dotenv').config();
const { Pool } = require('pg');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE users
        DROP CONSTRAINT IF EXISTS users_role_check
    `);

    await client.query(`
      ALTER TABLE users
        ADD CONSTRAINT users_role_check
          CHECK (role IN ('admin','dispatcher','operator','analyst','driver','cfo'))
    `);

    await client.query('COMMIT');
    console.log('[migrate-roles] users.role constraint updated to include driver + cfo');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate-roles] FAILED:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(() => process.exit(1));
