/**
 * T6.1: Sequential SQL migration runner.
 * Reads backend/migrations/*.sql in alphabetical order and tracks normal
 * migrations in schema_migrations.
 *
 * Reconciliation migrations are explicitly opt-in via the first-line marker
 * `-- @sonalit-reconcile-always`. They are intentionally executed on every
 * startup because the migration ledger cannot prove that the physical schema
 * survived a restore/import. They are idempotent and MUST NOT be recorded as
 * ordinary one-time migrations.
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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 10000,
});

function splitStatements(sql) {
  const stmts = [];
  const n = sql.length;
  let i = 0;
  let stmtStart = 0;

  while (i < n) {
    const c = sql[i];
    if (c === '-' && i + 1 < n && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && i + 1 < n && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < n && sql[j] !== '$' && sql[j] !== '\n') j++;
      if (j < n && sql[j] === '$') {
        const tag = sql.slice(i, j + 1);
        i = j + 1;
        while (i <= n - tag.length) {
          if (sql.slice(i, i + tag.length) === tag) { i += tag.length; break; }
          i++;
        }
        continue;
      }
    }
    if (c === ';') {
      const stmt = sql.slice(stmtStart, i + 1).trim();
      if (stmt && stmt !== ';') stmts.push(stmt);
      stmtStart = i + 1;
      i++;
      continue;
    }
    i++;
  }

  const tail = sql.slice(stmtStart).trim();
  if (tail) stmts.push(tail);
  return stmts;
}

function cleanMigration(rawSql) {
  return rawSql
    .split('\n')
    .filter(line => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(line))
    .join('\n');
}

function isReconciliation(rawSql) {
  return /^\s*--\s*@sonalit-reconcile-always\b/i.test(rawSql);
}

async function executeMigration(client, file, rawSql, { reconciliation = false } = {}) {
  const cleanSql = cleanMigration(rawSql);
  const statements = splitStatements(cleanSql).filter(s => {
    const code = s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    return code && code !== ';';
  });

  console.log(`[db-migrate] ${reconciliation ? 'reconcile' : 'apply'} ${file} (${statements.length} stmts)`);
  await client.query('BEGIN');
  try {
    for (let idx = 0; idx < statements.length; idx++) {
      try {
        await client.query(statements[idx]);
      } catch (stmtErr) {
        console.error(`[db-migrate] FAILED stmt ${idx + 1}/${statements.length} pg:${stmtErr.code}`);
        console.error(`[db-migrate] error: ${stmtErr.message}`);
        console.error(`[db-migrate] stmt: ${statements[idx].slice(0, 500)}`);
        throw stmtErr;
      }
    }
    if (!reconciliation) {
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    }
    await client.query('COMMIT');
    console.log(`[db-migrate] ${reconciliation ? 'reconciled' : 'done  '} ${file}`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`${reconciliation ? 'Reconciliation' : 'Migration'} ${file} failed: ${err.message}`);
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename)
    );

    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    let ran = 0;
    let reconciled = 0;

    for (const file of files) {
      const rawSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const reconciliation = isReconciliation(rawSql);

      if (reconciliation) {
        await executeMigration(client, file, rawSql, { reconciliation: true });
        reconciled++;
        continue;
      }

      if (applied.has(file)) {
        console.log(`[db-migrate] skip  ${file}`);
        continue;
      }

      await executeMigration(client, file, rawSql);
      ran++;
    }

    if (ran === 0 && reconciled === 0) console.log('[db-migrate] Nothing to apply — schema up to date');
    else console.log(`[db-migrate] Applied ${ran} migration(s); reconciled ${reconciled} reconciliation(s)`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().then(() => process.exit(0)).catch(err => {
  console.error('[db-migrate] FATAL: migration/reconciliation failed — backend will not start');
  console.error('[db-migrate] Error:', err.message);
  process.exit(1);
});
