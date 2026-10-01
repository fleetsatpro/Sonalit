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
    await client.query(`
      ALTER TABLE outbox ADD COLUMN IF NOT EXISTS org_id UUID;
      UPDATE outbox o SET org_id=w.org_id FROM webhooks w WHERE w.id=o.webhook_id AND o.org_id IS NULL;

      CREATE OR REPLACE FUNCTION tenant_notification_outbox() RETURNS trigger LANGUAGE plpgsql AS $
      DECLARE parent_org UUID;
      BEGIN
        SELECT org_id INTO parent_org FROM webhooks WHERE id=NEW.webhook_id;
        IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_webhook'; END IF;
        IF NEW.org_id IS NOT NULL AND NEW.org_id<>parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
        NEW.org_id:=parent_org; RETURN NEW;
      END $;
      DROP TRIGGER IF EXISTS tenant_notification_outbox ON outbox;
      CREATE TRIGGER tenant_notification_outbox BEFORE INSERT OR UPDATE ON outbox
        FOR EACH ROW EXECUTE FUNCTION tenant_notification_outbox();

      DO $
      DECLARE t text;
      BEGIN
        FOREACH t IN ARRAY ARRAY['webhooks','outbox','notification_log'] LOOP
          EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
          EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
          EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_service ON %I', t);
          EXECUTE format('CREATE POLICY tenant_isolation_service ON %I AS RESTRICTIVE FOR ALL
            USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)
            WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)', t);
          EXECUTE format('DROP POLICY IF EXISTS tenant_base_service ON %I', t);
          EXECUTE format('CREATE POLICY tenant_base_service ON %I AS PERMISSIVE FOR ALL
            USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)
            WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)', t);
        END LOOP;
      END $;
    `);
    await client.query('COMMIT');
    process.stdout.write('notification-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
