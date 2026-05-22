-- T1.1 — Row-Level Security + org_id on core tables
-- Run as a superuser (migration role). App user gets RLS enforced.
-- Uses current_setting('app.current_org_id', true) set by withOrg() helper.

BEGIN;

-- ── Add org_id to tables that are missing it ──────────────────────────────────

-- Default org UUID used for legacy single-tenant rows before multi-tenancy
DO $$
DECLARE default_org UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

  -- users: every user must belong to an org
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='org_id') THEN
    EXECUTE format('ALTER TABLE users ADD COLUMN org_id UUID DEFAULT %L', default_org::text);
    EXECUTE format('UPDATE users SET org_id = %L WHERE org_id IS NULL', default_org::text);
    ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;
  END IF;
  CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id) WHERE deleted_at IS NULL;

  -- vehicles
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vehicles' AND column_name='org_id') THEN
    EXECUTE format('ALTER TABLE vehicles ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_vehicles_org ON vehicles(org_id) WHERE deleted_at IS NULL;

  -- alerts
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alerts' AND column_name='org_id') THEN
    EXECUTE format('ALTER TABLE alerts ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(org_id) WHERE deleted_at IS NULL;

  -- incidents
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='incidents' AND column_name='org_id') THEN
    EXECUTE format('ALTER TABLE incidents ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents(org_id);

  -- gps_logs (vehicle-scoped, derive org via vehicle)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gps_logs' AND column_name='org_id') THEN
    EXECUTE format('ALTER TABLE gps_logs ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_gps_logs_org ON gps_logs(org_id, timestamp DESC);

  -- convoys: org_id was added nullable; make it NOT NULL with default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='convoys' AND column_name='org_id') THEN
    EXECUTE format('UPDATE convoys SET org_id = %L WHERE org_id IS NULL', default_org::text);
    ALTER TABLE convoys ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
    ALTER TABLE convoys ALTER COLUMN org_id SET NOT NULL;
  ELSE
    EXECUTE format('ALTER TABLE convoys ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_convoys_org ON convoys(org_id) WHERE deleted_at IS NULL;

  -- guardian_devices: ensure NOT NULL with default
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='guardian_devices' AND column_name='org_id') THEN
    EXECUTE format('UPDATE guardian_devices SET org_id = %L WHERE org_id IS NULL', default_org::text);
  ELSE
    EXECUTE format('ALTER TABLE guardian_devices ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_guardian_devices_org ON guardian_devices(org_id) WHERE deleted_at IS NULL;

  -- panic_events
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='panic_events' AND column_name='org_id') THEN
    EXECUTE format('UPDATE panic_events SET org_id = %L WHERE org_id IS NULL', default_org::text);
  ELSE
    EXECUTE format('ALTER TABLE panic_events ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_panic_events_org ON panic_events(org_id);

  -- drivers
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drivers' AND column_name='org_id') THEN
    EXECUTE format('ALTER TABLE drivers ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_drivers_org ON drivers(org_id) WHERE deleted_at IS NULL;

  -- field_reports
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='field_reports' AND column_name='org_id') THEN
    EXECUTE format('ALTER TABLE field_reports ADD COLUMN org_id UUID NOT NULL DEFAULT %L', default_org::text);
  END IF;
  CREATE INDEX IF NOT EXISTS idx_field_reports_org ON field_reports(org_id);

END $$;

-- ── Enable Row-Level Security ─────────────────────────────────────────────────
-- Policy: app.current_org_id session variable must match the row's org_id.
-- current_setting(..., true) returns NULL if the variable is not set, which
-- means unauthenticated connections see NO rows (fail-safe: deny by default).
-- Migrations bypass RLS because they run as superuser (BYPASSRLS).

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users', 'vehicles', 'convoys', 'alerts', 'incidents', 'gps_logs',
    'drivers', 'shipments', 'trips', 'invoices', 'expenses',
    'guardian_devices', 'panic_events'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      -- Drop before recreate to keep idempotent
      EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', tbl);
      EXECUTE format(
        'CREATE POLICY org_isolation ON %I
         USING (org_id = current_setting(''app.current_org_id'', true)::uuid)',
        tbl
      );
      -- Superuser / migration role bypasses RLS automatically (BYPASSRLS privilege)
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'Table % not found — skipping RLS', tbl;
    END;
  END LOOP;
END $$;

-- ── Audit chain index lives in 005_audit_chain_locking.sql (org_id added there) ─

COMMIT;
