import { pool } from '../db.js';
async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS media_assets (
        id UUID PRIMARY KEY, org_id UUID NOT NULL,
        kind TEXT NOT NULL, name TEXT, status TEXT NOT NULL DEFAULT 'pending',
        r2_key TEXT NOT NULL, url TEXT, size_bytes BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        committed_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_media_org ON media_assets(org_id) WHERE deleted_at IS NULL;
    `);
    await client.query('COMMIT');
    process.stdout.write('media-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
