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
    await client.query(`
      ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
      ALTER TABLE reports FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_service ON reports;
      CREATE POLICY tenant_isolation_service ON reports AS RESTRICTIVE FOR ALL
        USING (org_id = NULLIF(current_setting('app.current_org_id', true), '''')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '''')::uuid);
      DROP POLICY IF EXISTS tenant_base_service ON reports;
      CREATE POLICY tenant_base_service ON reports AS PERMISSIVE FOR ALL
        USING (org_id = NULLIF(current_setting('app.current_org_id', true), '''')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '''')::uuid);
    `);
    await client.query('COMMIT');
    process.stdout.write('reports-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
