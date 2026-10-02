import { pool } from '../db.js';
async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS convoys (
        id UUID PRIMARY KEY, org_id UUID NOT NULL, name TEXT NOT NULL,
        description TEXT, timezone TEXT NOT NULL DEFAULT 'UTC',
        start_date TIMESTAMPTZ, end_date TIMESTAMPTZ,
        seal_count_per_truck INT, notes TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS convoy_vehicles (convoy_id UUID NOT NULL, vehicle_id UUID NOT NULL, PRIMARY KEY (convoy_id, vehicle_id));
      CREATE TABLE IF NOT EXISTS convoy_drivers (convoy_id UUID NOT NULL, driver_id UUID NOT NULL, PRIMARY KEY (convoy_id, driver_id));
      CREATE TABLE IF NOT EXISTS convoy_cfos (convoy_id UUID NOT NULL, cfo_id UUID NOT NULL, pin_hash TEXT NOT NULL, PRIMARY KEY (convoy_id, cfo_id));
    `);
    await client.query(`
      ALTER TABLE convoy_vehicles ADD COLUMN IF NOT EXISTS org_id UUID;
      ALTER TABLE convoy_drivers ADD COLUMN IF NOT EXISTS org_id UUID;
      ALTER TABLE convoy_cfos ADD COLUMN IF NOT EXISTS org_id UUID;

      UPDATE convoy_vehicles cv SET org_id=c.org_id FROM convoys c WHERE c.id=cv.convoy_id AND cv.org_id IS NULL;
      UPDATE convoy_drivers cd SET org_id=c.org_id FROM convoys c WHERE c.id=cd.convoy_id AND cd.org_id IS NULL;
      UPDATE convoy_cfos cc SET org_id=c.org_id FROM convoys c WHERE c.id=cc.convoy_id AND cc.org_id IS NULL;

      CREATE OR REPLACE FUNCTION tenant_convoy_join() RETURNS trigger LANGUAGE plpgsql AS $tenant$
      DECLARE parent_org UUID;
      BEGIN
        SELECT org_id INTO parent_org FROM convoys WHERE id=NEW.convoy_id;
        IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_convoy'; END IF;
        IF NEW.org_id IS NOT NULL AND NEW.org_id<>parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
        NEW.org_id:=parent_org; RETURN NEW;
      END $tenant$;

      DROP TRIGGER IF EXISTS tenant_convoy_vehicles ON convoy_vehicles;
      CREATE TRIGGER tenant_convoy_vehicles BEFORE INSERT OR UPDATE ON convoy_vehicles
        FOR EACH ROW EXECUTE FUNCTION tenant_convoy_join();
      DROP TRIGGER IF EXISTS tenant_convoy_drivers ON convoy_drivers;
      CREATE TRIGGER tenant_convoy_drivers BEFORE INSERT OR UPDATE ON convoy_drivers
        FOR EACH ROW EXECUTE FUNCTION tenant_convoy_join();
      DROP TRIGGER IF EXISTS tenant_convoy_cfos ON convoy_cfos;
      CREATE TRIGGER tenant_convoy_cfos BEFORE INSERT OR UPDATE ON convoy_cfos
        FOR EACH ROW EXECUTE FUNCTION tenant_convoy_join();

      DO $tenant$
      DECLARE t text;
      BEGIN
        FOREACH t IN ARRAY ARRAY['convoys','convoy_vehicles','convoy_drivers','convoy_cfos'] LOOP
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
      END $tenant$;
    `);
    await client.query('COMMIT');
    process.stdout.write('convoy-svc migrations complete\n');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
