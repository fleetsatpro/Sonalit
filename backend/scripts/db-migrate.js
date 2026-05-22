/**
 * T6.1: Sequential SQL migration runner.
 * Reads backend/migrations/*.sql in alphabetical order,
 * tracks applied files in schema_migrations table,
 * skips already-applied ones.
 *
 * Each migration is split into individual statements (dollar-quote-aware)
 * and executed one at a time inside a single transaction so we can log
 * the exact failing statement with its pg error code.
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
 * Split SQL text into individual statements, correctly handling:
 *   - Line comments  (-- ...)
 *   - Single-quoted strings  ('...')  including '' escapes
 *   - Dollar-quoted blocks  ($tag$...$tag$)  used by PL/pgSQL
 *
 * Uses an index-based scanner so there is no accumulation bug.
 */
function splitStatements(sql) {
  const stmts = [];
  const n = sql.length;
  let i = 0;
  let stmtStart = 0;

  while (i < n) {
    const c = sql[i];

    // ── Line comment: skip to end of line ─────────────────────────────────
    if (c === '-' && i + 1 < n && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }

    // ── Single-quoted string ───────────────────────────────────────────────
    if (c === "'") {
      i++; // consume opening quote
      while (i < n) {
        if (sql[i] === "'" && i + 1 < n && sql[i + 1] === "'") {
          i += 2; // escaped ''
          continue;
        }
        if (sql[i] === "'") { i++; break; } // closing quote
        i++;
      }
      continue;
    }

    // ── Dollar-quoted block ────────────────────────────────────────────────
    if (c === '$') {
      // Scan for the closing '$' of the tag (e.g. $$ or $tag$)
      let j = i + 1;
      while (j < n && sql[j] !== '$' && sql[j] !== '\n') j++;
      if (j < n && sql[j] === '$') {
        // Valid dollar-quote tag found
        const tag = sql.slice(i, j + 1); // e.g. "$$" or "$ext$"
        i = j + 1; // skip past opening tag
        // Scan forward for the identical closing tag
        while (i <= n - tag.length) {
          if (sql.slice(i, i + tag.length) === tag) {
            i += tag.length; // skip past closing tag
            break;
          }
          i++;
        }
        continue;
      }
      // Not a dollar-quote (lone $ or $ followed by newline) — fall through
    }

    // ── Statement boundary ─────────────────────────────────────────────────
    if (c === ';') {
      const stmt = sql.slice(stmtStart, i + 1).trim();
      if (stmt && stmt !== ';') stmts.push(stmt);
      stmtStart = i + 1;
      i++;
      continue;
    }

    i++;
  }

  // Trailing content without a trailing semicolon
  const tail = sql.slice(stmtStart).trim();
  if (tail) stmts.push(tail);

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
      // Strip standalone BEGIN;/COMMIT;/ROLLBACK; lines so the runner's own
      // BEGIN/COMMIT owns the transaction. PL/pgSQL BEGIN blocks are preserved
      // (they appear without a trailing semicolon on their own line).
      const cleanSql = rawSql
        .split('\n')
        .filter(line => !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/i.test(line))
        .join('\n');

      const statements = splitStatements(cleanSql).filter(s => {
        // Drop statements that are entirely comments or whitespace
        const code = s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
        return code && code !== ';';
      });

      console.log(`[db-migrate] apply ${file} (${statements.length} stmts)`);
      await client.query('BEGIN');
      try {
        for (let idx = 0; idx < statements.length; idx++) {
          const stmt = statements[idx];
          try {
            await client.query(stmt);
          } catch (stmtErr) {
            console.error(`[db-migrate] FAILED stmt ${idx + 1}/${statements.length} pg:${stmtErr.code}`);
            console.error(`[db-migrate] error: ${stmtErr.message}`);
            console.error(`[db-migrate] stmt: ${stmt.slice(0, 400)}`);
            throw stmtErr;
          }
        }
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[db-migrate] done   ${file}`);
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
