-- Tenant isolation hardening.
-- This migration is deliberately additive: it preserves existing policies and
-- adds a restrictive tenant gate so one permissive legacy policy can never
-- accidentally widen a tenant boundary. Legacy/unmapped rows remain invisible
-- because org_id stays NULL.
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add tenant columns to legacy child/infrastructure tables and derive them
--    only from an authoritative tenant-bearing parent. Never guess an org.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.convoy_assignments') IS NOT NULL THEN
    ALTER TABLE convoy_assignments ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.checkpoints') IS NOT NULL THEN
    ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.trips') IS NOT NULL THEN
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.invoices') IS NOT NULL THEN
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.expenses') IS NOT NULL THEN
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.driver_events') IS NOT NULL THEN
    ALTER TABLE driver_events ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.geofence_actions') IS NOT NULL THEN
    ALTER TABLE geofence_actions ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.sensor_logs') IS NOT NULL THEN
    ALTER TABLE sensor_logs ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.api_keys') IS NOT NULL THEN
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.documents') IS NOT NULL THEN
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.fuel_logs') IS NOT NULL THEN
    ALTER TABLE fuel_logs ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.convoy_trucks') IS NOT NULL THEN
    ALTER TABLE convoy_trucks ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.convoy_cfos') IS NOT NULL THEN
    ALTER TABLE convoy_cfos ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.convoy_cfo_truck_assignments') IS NOT NULL THEN
    ALTER TABLE convoy_cfo_truck_assignments ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.convoy_truck_photos') IS NOT NULL THEN
    ALTER TABLE convoy_truck_photos ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.convoy_daily_reports') IS NOT NULL THEN
    ALTER TABLE convoy_daily_reports ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.device_locations') IS NOT NULL THEN
    ALTER TABLE device_locations ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.device_health') IS NOT NULL THEN
    ALTER TABLE device_health ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.device_commands') IS NOT NULL THEN
    ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.field_reports') IS NOT NULL THEN
    ALTER TABLE field_reports ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
END $$;

UPDATE convoy_assignments ca
SET org_id = c.org_id
FROM convoys c
WHERE ca.convoy_id = c.id AND ca.org_id IS NULL AND c.org_id IS NOT NULL;

UPDATE checkpoints cp
SET org_id = COALESCE(
  (SELECT s.org_id FROM shipments s WHERE s.id = cp.shipment_id),
  (SELECT c.org_id FROM convoys c WHERE c.id = cp.convoy_id)
)
WHERE cp.org_id IS NULL;

UPDATE trips t
SET org_id = COALESCE(
  (SELECT c.org_id FROM convoys c WHERE c.id = t.convoy_id),
  (SELECT s.org_id FROM shipments s WHERE s.id = t.shipment_id),
  (SELECT v.org_id FROM vehicles v WHERE v.id = t.vehicle_id),
  (SELECT d.org_id FROM drivers d WHERE d.id = t.driver_id)
)
WHERE t.org_id IS NULL;

UPDATE invoices i
SET org_id = COALESCE(
  (SELECT s.org_id FROM shipments s WHERE s.id = i.shipment_id),
  (SELECT t.org_id FROM trips t WHERE t.id = i.trip_id),
  (SELECT u.org_id FROM users u WHERE u.id = i.created_by)
)
WHERE i.org_id IS NULL;

UPDATE expenses e
SET org_id = COALESCE(
  (SELECT t.org_id FROM trips t WHERE t.id = e.trip_id),
  (SELECT v.org_id FROM vehicles v WHERE v.id = e.vehicle_id),
  (SELECT d.org_id FROM drivers d WHERE d.id = e.driver_id),
  (SELECT u.org_id FROM users u WHERE u.id = e.recorded_by)
)
WHERE e.org_id IS NULL;

UPDATE driver_events de
SET org_id = COALESCE(
  (SELECT d.org_id FROM drivers d WHERE d.id = de.driver_id),
  (SELECT v.org_id FROM vehicles v WHERE v.id = de.vehicle_id),
  (SELECT t.org_id FROM trips t WHERE t.id = de.trip_id)
)
WHERE de.org_id IS NULL;

UPDATE geofence_actions ga
SET org_id = g.org_id
FROM geofences g
WHERE ga.geofence_id = g.id AND ga.org_id IS NULL;

UPDATE sensor_logs sl
SET org_id = v.org_id
FROM vehicles v
WHERE sl.vehicle_id = v.id AND sl.org_id IS NULL;

UPDATE documents d
SET org_id = c.org_id
FROM convoys c
WHERE d.convoy_id = c.id AND d.org_id IS NULL;

UPDATE fuel_logs fl
SET org_id = v.org_id
FROM vehicles v
WHERE fl.vehicle_id = v.id AND fl.org_id IS NULL;

UPDATE convoy_trucks ct
SET org_id = c.org_id
FROM convoys c
WHERE ct.convoy_id = c.id AND ct.org_id IS NULL;

UPDATE convoy_cfos cc
SET org_id = c.org_id
FROM convoys c
WHERE cc.convoy_id = c.id AND cc.org_id IS NULL;

UPDATE convoy_cfo_truck_assignments a
SET org_id = c.org_id
FROM convoys c
WHERE a.convoy_id = c.id AND a.org_id IS NULL;

UPDATE convoy_truck_photos p
SET org_id = c.org_id
FROM convoys c
WHERE p.convoy_id = c.id AND p.org_id IS NULL;

UPDATE convoy_daily_reports r
SET org_id = c.org_id
FROM convoys c
WHERE r.convoy_id = c.id AND r.org_id IS NULL;

UPDATE device_locations dl
SET org_id = d.org_id
FROM guardian_devices d
WHERE dl.device_id = d.id AND dl.org_id IS NULL;

UPDATE device_health dh
SET org_id = d.org_id
FROM guardian_devices d
WHERE dh.device_id = d.id AND dh.org_id IS NULL;

UPDATE device_commands dc
SET org_id = d.org_id
FROM guardian_devices d
WHERE dc.device_id = d.id AND dc.org_id IS NULL;

UPDATE field_reports fr
SET org_id = d.org_id
FROM guardian_devices d
WHERE fr.device_id = d.id AND fr.org_id IS NULL;

UPDATE notifications n
SET org_id = u.org_id
FROM users u
WHERE n.user_id = u.id AND n.org_id IS NULL;

-- API keys had no ownership column. Existing legacy keys are intentionally left
-- NULL and therefore become unreachable from tenant-scoped app sessions. New
-- keys are written with org_id by routes/apikeys.js.
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id) WHERE org_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tenant RLS gate.
--    A RESTRICTIVE policy is additive and cannot weaken an existing policy.
--    FORCE RLS makes the rule apply to table-owner sessions too.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
  has_permissive BOOLEAN;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN ('runtime_diagnostics')
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'org_id'
          AND NOT a.attisdropped
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schema_name, r.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.schema_name, r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_hardening ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_hardening ON %I.%I AS RESTRICTIVE FOR ALL
         USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)
         WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
      r.schema_name, r.table_name
    );

    SELECT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = r.schema_name
        AND p.tablename = r.table_name
        AND p.permissive = 'PERMISSIVE'
    ) INTO has_permissive;

    IF NOT has_permissive THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation_base ON %I.%I AS PERMISSIVE FOR ALL
           USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)
           WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
        r.schema_name, r.table_name
      );
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fail-closed inserts for the high-risk legacy child tables.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'convoy_assignments','checkpoints','trips','invoices','expenses',
    'driver_events','geofence_actions','sensor_logs','api_keys','documents',
    'fuel_logs','convoy_trucks','convoy_cfos','convoy_cfo_truck_assignments',
    'convoy_truck_photos','convoy_daily_reports','device_locations',
    'device_health','device_commands','field_reports','notifications'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(org_id)', 'idx_tenant_' || t, t);
    END IF;
  END LOOP;
END $$;

COMMIT;
