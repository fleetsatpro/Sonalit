'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Enable the CFO module feature flag
    const result = await client.query(`
      UPDATE guardian_config SET value_int = 1, updated_at = NOW()
      WHERE key = 'cfo_module_enabled'
    `);

    if (result.rowCount === 0) {
      // Row doesn't exist yet — insert it (migrations may not have run)
      await client.query(`
        INSERT INTO guardian_config (key, value_int, value_text, updated_at)
        VALUES ('cfo_module_enabled', 1, NULL, NOW())
      `);
      console.log('[enable-cfo] Flag inserted with value_int = 1');
    } else {
      console.log('[enable-cfo] Flag updated to value_int = 1');
    }

    await client.query('COMMIT');
    console.log('[enable-cfo] Done — CFO module is now ENABLED');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[enable-cfo] Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
