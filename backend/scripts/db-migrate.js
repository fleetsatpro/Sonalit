/**
 * T6.1: Sequential SQL migration runner.
 * Reads backend/migrations/*.sql in alphabetical order,
 * tracks applied files in schema_migrations table,
 * skips already-applied ones.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('[db-migrate] DATABASE_URL not set — skipping');
  process.exit(0);
}

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename)
    );

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[db-migrate] skip  ${file}`);
        continue;
      }
      const rawSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      // Strip standalone transaction-control statements so the runner's
      // BEGIN/COMMIT owns the transaction boundary. Preserves PL/pgSQL
      // BEGIN/END blocks (which never end with a bare semicolon on that line).
      const sql = rawSql
        .split('\n')
        .filter(line => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(line))
        .join('\n');
      console.log(`[db-migrate] apply ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    if (ran === 0) {
      console.log('[db-migrate] Nothing to apply — schema up to date');
    } else {
      console.log(`[db-migrate] Applied ${ran} migration(s)`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('[db-migrate] Fatal:', err.message);
  process.exit(1);
});
