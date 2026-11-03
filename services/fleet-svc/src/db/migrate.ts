import { pool } from '../db.js';

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        plate TEXT NOT NULL,
        make TEXT NOT NULL,
        model TEXT NOT NULL,
        year INT NOT NULL,
        vin TEXT,
        fuel_type TEXT NOT NULL DEFAULT 'diesel',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_vehicles_org ON vehicles(org_id) WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS drivers (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        license_number TEXT,
        license_expiry DATE,
        status TEXT NOT NULL DEFAULT 'off_duty',
        current_vehicle_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_drivers_org ON drivers(org_id) WHERE deleted_at IS NULL;

      CREATE TABLE IF NOT EXISTS geofences (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'both',
        geojson JSONB NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS maintenance_records (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        vehicle_id UUID,
        type TEXT NOT NULL,
        scheduled_date DATE NOT NULL,
        completed_date DATE,
        status TEXT NOT NULL DEFAULT 'scheduled',
        notes TEXT,
        cost NUMERIC(12,2),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS shipments (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        shipment_number TEXT NOT NULL,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        cargo_description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        vehicle_id UUID,
        driver_id UUID,
        scheduled_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS message_threads (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        subject TEXT,
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS thread_participants (
        thread_id UUID NOT NULL,
        user_id UUID NOT NULL,
        PRIMARY KEY (thread_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        thread_id UUID NOT NULL,
        sender_id UUID NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS risk_zones (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        h3_index TEXT NOT NULL,
        risk_level TEXT NOT NULL DEFAULT 'low',
        event_count INT NOT NULL DEFAULT 0,
        center_lat NUMERIC(10,7) NOT NULL,
        center_lon NUMERIC(10,7) NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(org_id, h3_index)
      );

      CREATE TABLE IF NOT EXISTS field_officers (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        name TEXT NOT NULL,
        badge_number TEXT NOT NULL,
        phone TEXT NOT NULL,
        assigned_zone TEXT,
        status TEXT NOT NULL DEFAULT 'offline',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS finance_records (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        category TEXT NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        description TEXT,
        vehicle_id UUID,
        driver_id UUID,
        transaction_date DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);
    await client.query(`
      ALTER TABLE thread_participants ADD COLUMN IF NOT EXISTS org_id UUID;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS org_id UUID;

      UPDATE thread_participants tp SET org_id=mt.org_id
      FROM message_threads mt
      WHERE mt.id=tp.thread_id AND tp.org_id IS NULL;

      UPDATE messages m SET org_id=mt.org_id
      FROM message_threads mt
      WHERE mt.id=m.thread_id AND m.org_id IS NULL;

      CREATE OR REPLACE FUNCTION tenant_fleet_thread_participant() RETURNS trigger LANGUAGE plpgsql AS $
      DECLARE parent_org UUID;
      BEGIN
        SELECT org_id INTO parent_org FROM message_threads WHERE id=NEW.thread_id;
        IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_thread'; END IF;
        IF NEW.org_id IS NOT NULL AND NEW.org_id<>parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
        NEW.org_id:=parent_org; RETURN NEW;
      END $;

      CREATE OR REPLACE FUNCTION tenant_fleet_message() RETURNS trigger LANGUAGE plpgsql AS $
      DECLARE parent_org UUID;
      BEGIN
        SELECT org_id INTO parent_org FROM message_threads WHERE id=NEW.thread_id;
        IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_thread'; END IF;
        IF NEW.org_id IS NOT NULL AND NEW.org_id<>parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
        NEW.org_id:=parent_org; RETURN NEW;
      END $;

      DROP TRIGGER IF EXISTS tenant_fleet_thread_participant ON thread_participants;
      CREATE TRIGGER tenant_fleet_thread_participant BEFORE INSERT OR UPDATE ON thread_participants
        FOR EACH ROW EXECUTE FUNCTION tenant_fleet_thread_participant();

      DROP TRIGGER IF EXISTS tenant_fleet_message ON messages;
      CREATE TRIGGER tenant_fleet_message BEFORE INSERT OR UPDATE ON messages
        FOR EACH ROW EXECUTE FUNCTION tenant_fleet_message();

      DO $
      DECLARE t text;
      BEGIN
        FOREACH t IN ARRAY ARRAY[
          'vehicles','drivers','geofences','maintenance_records','shipments',
          'message_threads','thread_participants','messages','risk_zones',
          'field_officers','finance_records'
        ] LOOP
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
    process.stdout.write('fleet-svc migrations complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

migrate().catch((err: Error) => { process.stderr.write(`Migration failed: ${err.message}\n`); process.exit(1); });
