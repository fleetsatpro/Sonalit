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
