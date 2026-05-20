import { pool } from '../db.js';
async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks (id UUID PRIMARY KEY, org_id UUID NOT NULL, url TEXT NOT NULL, events JSONB NOT NULL, secret TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS outbox (id UUID PRIMARY KEY, webhook_id UUID NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), delivered_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS notification_log (id UUID PRIMARY KEY, org_id UUID NOT NULL, kind TEXT NOT NULL, recipient TEXT, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    `);
    await client.query('COMMIT');
    process.stdout.write('notification-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
