import { pool } from '../db.js';
async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY, org_id UUID NOT NULL,
        title TEXT NOT NULL, type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        url TEXT, params JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `);
    await client.query('COMMIT');
    process.stdout.write('reports-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
