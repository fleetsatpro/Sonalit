/**
 * T6.1: Sequential SQL migration runner.
 * Reads backend/migrations/*.sql in alphabetical order,
 * tracks applied files in schema_migrations table,
 * skips already-applied ones.
 *
 * Each migration runs in its own BEGIN/COMMIT. Standalone BEGIN;/COMMIT;/
 * ROLLBACK; lines are stripped before execution so the runner owns the
 * transaction boundary. PL/pgSQL BEGIN/END blocks are preserved (no `;`).
 *
 * Statements are split and executed one at a time so the exact failing
 * statement is logged with its pg error code.
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
});

/**
 * Split a SQL string into individual statements, respecting dollar-quoting
 * (used in PL/pgSQL function bodies) and single-quoted strings.
 */
function splitStatements(sql) {
  const stmts = [];
  let buf = '';
  let inDollar = false;
  let dollarTag = '';
  let inSingleQuote = false;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Single-quoted string toggle (handles escaped quotes via '')
    if (!inDollar && ch === "'") {
      inSingleQuote = !inSingleQuote;
      buf += ch;
      i++;
      // Handle '' escape inside single-quoted string
      if (inSingleQuote && sql[i] === "'") {
        buf += sql[i++];
        inSingleQuote = true; // still inside
      }
      continue;
    }

    // Dollar-quote detection (only outside single-quoted strings)
    if (!inSingleQuote && !inDollar && ch === '$') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '$' && sql[j] !== '\n') j++;
      if (j < sql.length && sql[j] === '$') {
        const tag = sql.slice(i, j + 1);
        dollarTag = tag;
        inDollar = true;
        buf += tag;
        i = j + 1;
        continue;
      }
    }

    // Dollar-quote end
    if (inDollar && sql.slice(i, i + dollarTag.length) === dollarTag) {
      buf += dollarTag;
      i += dollarTag.length;
      inDollar = false;
      dollarTag = '';
      continue;
    }

    // Statement boundary
    if (!inDollar && !inSingleQuote && ch === ';') {
      buf += ';';
      const stmt = buf.trim();
      if (stmt && stmt !== ';') stmts.push(stmt);
      buf = '';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  if (buf.trim()) stmts.push(buf.trim());
  return stmts;
}

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
      // Strip standalone transaction-control statements (BEGIN;/COMMIT;/ROLLBACK;)
      // so the runner's own BEGIN/COMMIT owns the boundary. Preserves
      // PL/pgSQL BEGIN blocks inside function bodies (those lack the semicolon).
      const cleanSql = rawSql
        .split('\n')
        .filter(line => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(line))
        .join('\n');

      const statements = splitStatements(cleanSql).filter(s => {
        const stripped = s.replace(/--[^\n]*/g, '').trim();
        return stripped && stripped !== ';';
      });

      console.log(`[db-migrate] apply ${file} (${statements.length} statements)`);
      await client.query('BEGIN');
      try {
        for (let idx = 0; idx < statements.length; idx++) {
          const stmt = statements[idx];
          try {
            await client.query(stmt);
          } catch (stmtErr) {
            console.error(
              `[db-migrate] stmt ${idx + 1}/${statements.length} FAILED` +
              ` [pg:${stmtErr.code}] ${stmtErr.message}`
            );
            console.error('[db-migrate] failing stmt:', stmt.slice(0, 300));
            throw stmtErr;
          }
        }
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
