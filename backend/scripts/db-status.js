/**
 * T6.1: Show migration status — which SQL files have been applied vs pending.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[db-status] DATABASE_URL not set');
  process.exit(1);
}

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    let applied = new Map();
    try {
      const rows = (await client.query('SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at')).rows;
      for (const r of rows) applied.set(r.filename, r.applied_at);
    } catch {
      console.log('[db-status] schema_migrations table not found — run db:migrate first');
    }

    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

    let pending = 0;
    for (const f of files) {
      if (applied.has(f)) {
        console.log(`  [applied] ${f}  (${applied.get(f).toISOString().slice(0, 19)})`);
      } else {
        console.log(`  [PENDING] ${f}`);
        pending++;
      }
    }
    if (pending > 0) {
      console.log(`\n${pending} migration(s) pending`);
      process.exit(1);
    } else {
      console.log('\nSchema up to date');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('[db-status] Fatal:', err.message);
  process.exit(1);
});
