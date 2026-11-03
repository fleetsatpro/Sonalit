import { pool } from '../db.js';

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_decisions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id      UUID        NOT NULL,
        user_id     UUID        NOT NULL,
        query       TEXT        NOT NULL,
        response    TEXT        NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_decisions_org_id
        ON ai_decisions (org_id, created_at DESC);
    `);

    await client.query(`
      ALTER TABLE ai_decisions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ai_decisions FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_service ON ai_decisions;
      CREATE POLICY tenant_isolation_service ON ai_decisions AS RESTRICTIVE FOR ALL
        USING (org_id = NULLIF(current_setting('app.current_org_id', true), '''')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '''')::uuid);
      DROP POLICY IF EXISTS tenant_base_service ON ai_decisions;
      CREATE POLICY tenant_base_service ON ai_decisions AS PERMISSIVE FOR ALL
        USING (org_id = NULLIF(current_setting('app.current_org_id', true), '''')::uuid)
        WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '''')::uuid);
    `);
    process.stdout.write('ai-copilot-svc migrations complete\n');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err: Error) => {
  process.stderr.write(`Migration failed: ${err.message}\n`);
  process.exit(1);
});
