import { pool } from '../db.js';

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS rules (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        UUID NOT NULL,
        name          TEXT NOT NULL,
        description   TEXT,
        condition_type TEXT NOT NULL CHECK (condition_type IN ('speed','geofence','idle','battery')),
        threshold     NUMERIC NOT NULL,
        action_type   TEXT NOT NULL CHECK (action_type IN ('alert','notify')),
        enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS rules_org_enabled_idx ON rules (org_id, enabled)
        WHERE deleted_at IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        UUID NOT NULL,
        type          TEXT NOT NULL,
        severity      TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
        title         TEXT NOT NULL,
        description   TEXT,
        status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','suppressed')),
        vehicle_id    UUID,
        driver_id     UUID,
        metadata      JSONB NOT NULL DEFAULT '{}',
        notes         TEXT,
        rule_id       UUID REFERENCES rules(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_org_status_idx ON alerts (org_id, status)
        WHERE deleted_at IS NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS alerts_org_severity_idx ON alerts (org_id, severity)
        WHERE deleted_at IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id         UUID NOT NULL,
        title          TEXT NOT NULL,
        description    TEXT,
        severity       TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
        status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
        assigned_to_id UUID,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS incidents_org_status_idx ON incidents (org_id, status)
        WHERE deleted_at IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS incident_actions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id  UUID NOT NULL REFERENCES incidents(id),
        action_type  TEXT NOT NULL,
        notes        TEXT,
        actor_id     UUID NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS incident_actions_incident_idx
        ON incident_actions (incident_id)
    `);

    await client.query(`
      ALTER TABLE incident_actions ADD COLUMN IF NOT EXISTS org_id UUID;
      UPDATE incident_actions ia SET org_id=i.org_id FROM incidents i WHERE i.id=ia.incident_id AND ia.org_id IS NULL;
      CREATE OR REPLACE FUNCTION tenant_alert_incident_action() RETURNS trigger LANGUAGE plpgsql AS $
      DECLARE parent_org UUID;
      BEGIN
        SELECT org_id INTO parent_org FROM incidents WHERE id=NEW.incident_id;
        IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_incident'; END IF;
        IF NEW.org_id IS NOT NULL AND NEW.org_id<>parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
        NEW.org_id:=parent_org; RETURN NEW;
      END $;
      DROP TRIGGER IF EXISTS tenant_alert_incident_action ON incident_actions;
      CREATE TRIGGER tenant_alert_incident_action BEFORE INSERT OR UPDATE ON incident_actions
        FOR EACH ROW EXECUTE FUNCTION tenant_alert_incident_action();
      DO $
      DECLARE t text;
      BEGIN
        FOREACH t IN ARRAY ARRAY['rules','alerts','incidents','incident_actions'] LOOP
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
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
