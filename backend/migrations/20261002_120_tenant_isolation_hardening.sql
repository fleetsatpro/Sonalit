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
DO $tenant$
BEGIN
  IF to_regclass('public.convoy_assignments') IS NOT NULL THEN
    ALTER TABLE convoy_assignments ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.convoy_waypoints') IS NOT NULL THEN
    ALTER TABLE convoy_waypoints ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.convoy_seals') IS NOT NULL THEN
    ALTER TABLE convoy_seals ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.convoy_route_waypoints') IS NOT NULL THEN
    ALTER TABLE convoy_route_waypoints ADD COLUMN IF NOT EXISTS org_id UUID;
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
  IF to_regclass('public.devices') IS NOT NULL THEN
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.guardian_audit_log') IS NOT NULL THEN
    ALTER TABLE guardian_audit_log ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.cfo_login_attempts') IS NOT NULL THEN
    ALTER TABLE cfo_login_attempts ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.guardian_command_nonces') IS NOT NULL THEN
    ALTER TABLE guardian_command_nonces ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
  IF to_regclass('public.device_command_events') IS NOT NULL THEN
    ALTER TABLE device_command_events ADD COLUMN IF NOT EXISTS org_id UUID;
  END IF;
END $tenant$;

UPDATE convoy_assignments ca
SET org_id = c.org_id
FROM convoys c
WHERE ca.convoy_id = c.id AND ca.org_id IS NULL AND c.org_id IS NOT NULL;

UPDATE convoy_waypoints w
SET org_id = c.org_id
FROM convoys c
WHERE w.convoy_id = c.id AND w.org_id IS NULL;

UPDATE convoy_seals s
SET org_id = c.org_id
FROM convoys c
WHERE s.convoy_id = c.id AND s.org_id IS NULL;

UPDATE convoy_route_waypoints w
SET org_id = c.org_id
FROM convoys c
WHERE w.convoy_id = c.id AND w.org_id IS NULL;

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

UPDATE devices d
SET org_id = v.org_id
FROM vehicles v
WHERE d.vehicle_id = v.id AND d.org_id IS NULL;

UPDATE guardian_audit_log a
SET org_id = u.org_id
FROM users u
WHERE a.actor_type = 'admin' AND a.actor_id = u.id AND a.org_id IS NULL;

UPDATE guardian_audit_log a
SET org_id = d.org_id
FROM guardian_devices d
WHERE a.actor_type = 'device' AND a.actor_id = d.id AND a.org_id IS NULL;

UPDATE cfo_login_attempts a
SET org_id = d.org_id
FROM guardian_devices d
WHERE a.device_id = d.id AND a.org_id IS NULL;

UPDATE guardian_command_nonces n
SET org_id = d.org_id
FROM guardian_devices d
WHERE n.device_id = d.id AND n.org_id IS NULL;

UPDATE device_command_events e
SET org_id = dc.org_id
FROM device_commands dc
WHERE e.command_id = dc.id AND e.org_id IS NULL;

-- API keys had no ownership column. Existing legacy keys are intentionally left
-- NULL and therefore become unreachable from tenant-scoped app sessions. New
-- keys are written with org_id by routes/apikeys.js.
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id) WHERE org_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tenant RLS gate.
-- A RESTRICTIVE policy is additive: existing permission policies may continue
-- to express role/resource rules, but none can widen the tenant boundary.
-- FORCE RLS also closes table-owner bypasses.
-- ─────────────────────────────────────────────────────────────────────────────
DO $tenant$
DECLARE
  r RECORD;
  has_permissive BOOLEAN;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
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

    -- Bootstrap credentials are looked up before a tenant is known. They are
    -- intentionally NOT FORCEd so the exact-match bootstrap lookup can resolve
    -- the tenant. After authentication, all downstream access uses
    -- sonalit_app + app.current_org_id and therefore still hits RLS.
    IF r.table_name NOT IN (
      'users',
      'guardian_devices',
      'portal_tokens',
      'cargo_clients',
      'client_magic_links',
      'telemetry_ingest_keys',
      'tracking_qr_codes',
      'tracking_sessions',
      'field_devices',
      'field_sessions',
      'field_agent_pins',
      'enrollment_codes',
      'convoy_codes',
      'cfo_login_attempts',
      'guardian_command_nonces'
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.schema_name, r.table_name);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_hardening ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_global_risk_read ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_hardening_write ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_base ON %I.%I', r.schema_name, r.table_name);

    IF r.table_name = 'risk_zones' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation_hardening ON %I.%I AS RESTRICTIVE FOR ALL
           USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid OR org_id IS NULL)
           WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
        r.schema_name, r.table_name
      );
      -- Global intelligence rows (org_id IS NULL) are intentionally readable,
      -- but tenant-created rows can never be NULL. This compensates for any
      -- older permissive policy that only allowed exact-tenant rows.
      EXECUTE format(
        'CREATE POLICY tenant_global_risk_read ON %I.%I AS PERMISSIVE FOR SELECT
           USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid OR org_id IS NULL)',
        r.schema_name, r.table_name
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation_hardening ON %I.%I AS RESTRICTIVE FOR ALL
           USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)
           WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
        r.schema_name, r.table_name
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = r.schema_name
        AND p.tablename = r.table_name
        AND p.permissive = 'PERMISSIVE'
    ) INTO has_permissive;

    IF NOT has_permissive THEN
      IF r.table_name = 'risk_zones' THEN
        EXECUTE format(
          'CREATE POLICY tenant_isolation_base ON %I.%I AS PERMISSIVE FOR ALL
             USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid OR org_id IS NULL)
             WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
          r.schema_name, r.table_name
        );
      ELSE
        EXECUTE format(
          'CREATE POLICY tenant_isolation_base ON %I.%I AS PERMISSIVE FOR ALL
             USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)
             WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
          r.schema_name, r.table_name
        );
      END IF;
    END IF;
  END LOOP;
END $tenant$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Parent-derived tenant invariants.
-- Children cannot attach a row from another tenant: the trigger resolves the
-- authoritative parent and overwrites/checks NEW.org_id before the RLS policy
-- evaluates the write.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tenant_harden_org_from_vehicle() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id;
    IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_vehicle'; END IF;
  ELSE
    parent_org := NULLIF(current_setting('app.current_org_id', true), '')::uuid;
  END IF;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_required'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_convoy() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  IF NEW.convoy_id IS NOT NULL THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
    IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_convoy'; END IF;
  ELSE
    parent_org := NULLIF(current_setting('app.current_org_id', true), '')::uuid;
  END IF;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_required'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_checkpoint() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  IF NEW.convoy_id IS NOT NULL THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
  END IF;
  IF parent_org IS NULL AND NEW.shipment_id IS NOT NULL THEN
    SELECT org_id INTO parent_org FROM shipments WHERE id = NEW.shipment_id;
  END IF;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_checkpoint_parent'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_trip() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  IF NEW.convoy_id IS NOT NULL THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
  END IF;
  IF parent_org IS NULL AND NEW.shipment_id IS NOT NULL THEN
    SELECT org_id INTO parent_org FROM shipments WHERE id = NEW.shipment_id;
  END IF;
  IF parent_org IS NULL AND NEW.vehicle_id IS NOT NULL THEN
    SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id;
  END IF;
  IF parent_org IS NULL AND NEW.driver_id IS NOT NULL THEN
    SELECT org_id INTO parent_org FROM drivers WHERE id = NEW.driver_id;
  END IF;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_trip_parent'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_invoice() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  IF NEW.shipment_id IS NOT NULL THEN SELECT org_id INTO parent_org FROM shipments WHERE id = NEW.shipment_id; END IF;
  IF parent_org IS NULL AND NEW.trip_id IS NOT NULL THEN SELECT org_id INTO parent_org FROM trips WHERE id = NEW.trip_id; END IF;
  IF parent_org IS NULL AND NEW.created_by IS NOT NULL THEN SELECT org_id INTO parent_org FROM users WHERE id = NEW.created_by; END IF;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_invoice_parent'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_expense() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  IF NEW.trip_id IS NOT NULL THEN SELECT org_id INTO parent_org FROM trips WHERE id = NEW.trip_id; END IF;
  IF parent_org IS NULL AND NEW.vehicle_id IS NOT NULL THEN SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id; END IF;
  IF parent_org IS NULL AND NEW.driver_id IS NOT NULL THEN SELECT org_id INTO parent_org FROM drivers WHERE id = NEW.driver_id; END IF;
  IF parent_org IS NULL AND NEW.recorded_by IS NOT NULL THEN SELECT org_id INTO parent_org FROM users WHERE id = NEW.recorded_by; END IF;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_expense_parent'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_driver_event() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  IF NEW.driver_id IS NOT NULL THEN SELECT org_id INTO parent_org FROM drivers WHERE id = NEW.driver_id; END IF;
  IF parent_org IS NULL AND NEW.vehicle_id IS NOT NULL THEN SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id; END IF;
  IF parent_org IS NULL AND NEW.trip_id IS NOT NULL THEN SELECT org_id INTO parent_org FROM trips WHERE id = NEW.trip_id; END IF;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_driver_event_parent'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_device() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  SELECT org_id INTO parent_org FROM guardian_devices WHERE id = NEW.device_id;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_device'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_geofence() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  SELECT org_id INTO parent_org FROM geofences WHERE id = NEW.geofence_id;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_geofence'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_org_from_user() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  SELECT org_id INTO parent_org FROM users WHERE id = NEW.user_id;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_user'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

DROP TRIGGER IF EXISTS tenant_harden_sensor_logs ON sensor_logs;
CREATE TRIGGER tenant_harden_sensor_logs BEFORE INSERT OR UPDATE ON sensor_logs
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_vehicle();

DROP TRIGGER IF EXISTS tenant_harden_fuel_logs ON fuel_logs;
CREATE TRIGGER tenant_harden_fuel_logs BEFORE INSERT OR UPDATE ON fuel_logs
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_vehicle();

DROP TRIGGER IF EXISTS tenant_harden_documents ON documents;
CREATE TRIGGER tenant_harden_documents BEFORE INSERT OR UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_harden_geofence_actions ON geofence_actions;
CREATE TRIGGER tenant_harden_geofence_actions BEFORE INSERT OR UPDATE ON geofence_actions
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_geofence();

DROP TRIGGER IF EXISTS tenant_harden_convoy_assignments ON convoy_assignments;
CREATE TRIGGER tenant_harden_convoy_assignments BEFORE INSERT OR UPDATE ON convoy_assignments
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_harden_checkpoints ON checkpoints;
CREATE TRIGGER tenant_harden_checkpoints BEFORE INSERT OR UPDATE ON checkpoints
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_checkpoint();

DROP TRIGGER IF EXISTS tenant_harden_trips ON trips;
CREATE TRIGGER tenant_harden_trips BEFORE INSERT OR UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_trip();

DROP TRIGGER IF EXISTS tenant_harden_invoices ON invoices;
CREATE TRIGGER tenant_harden_invoices BEFORE INSERT OR UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_invoice();

DROP TRIGGER IF EXISTS tenant_harden_expenses ON expenses;
CREATE TRIGGER tenant_harden_expenses BEFORE INSERT OR UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_expense();

DROP TRIGGER IF EXISTS tenant_harden_driver_events ON driver_events;
CREATE TRIGGER tenant_harden_driver_events BEFORE INSERT OR UPDATE ON driver_events
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_driver_event();

DROP TRIGGER IF EXISTS tenant_harden_convoy_trucks ON convoy_trucks;
CREATE TRIGGER tenant_harden_convoy_trucks BEFORE INSERT OR UPDATE ON convoy_trucks
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_harden_convoy_cfos ON convoy_cfos;
CREATE TRIGGER tenant_harden_convoy_cfos BEFORE INSERT OR UPDATE ON convoy_cfos
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_harden_cfo_assignments ON convoy_cfo_truck_assignments;
CREATE TRIGGER tenant_harden_cfo_assignments BEFORE INSERT OR UPDATE ON convoy_cfo_truck_assignments
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_harden_convoy_photos ON convoy_truck_photos;
CREATE TRIGGER tenant_harden_convoy_photos BEFORE INSERT OR UPDATE ON convoy_truck_photos
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_harden_daily_reports ON convoy_daily_reports;
CREATE TRIGGER tenant_harden_daily_reports BEFORE INSERT OR UPDATE ON convoy_daily_reports
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_harden_device_locations ON device_locations;
CREATE TRIGGER tenant_harden_device_locations BEFORE INSERT OR UPDATE ON device_locations
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_device_health ON device_health;
CREATE TRIGGER tenant_harden_device_health BEFORE INSERT OR UPDATE ON device_health
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_device_commands ON device_commands;
CREATE TRIGGER tenant_harden_device_commands BEFORE INSERT OR UPDATE ON device_commands
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_field_reports ON field_reports;
CREATE TRIGGER tenant_harden_field_reports BEFORE INSERT OR UPDATE ON field_reports
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_command_nonces ON guardian_command_nonces;
CREATE OR REPLACE FUNCTION tenant_harden_org_from_command_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_org UUID;
BEGIN
  SELECT org_id INTO parent_org FROM device_commands WHERE id = NEW.command_id;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_command'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $$;

CREATE TRIGGER tenant_harden_command_nonces BEFORE INSERT OR UPDATE ON guardian_command_nonces
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_cfo_login_attempts ON cfo_login_attempts;
CREATE TRIGGER tenant_harden_cfo_login_attempts BEFORE INSERT OR UPDATE ON cfo_login_attempts
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_device_command_events ON device_command_events;
CREATE TRIGGER tenant_harden_device_command_events BEFORE INSERT OR UPDATE ON device_command_events
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_command_event();

DROP TRIGGER IF EXISTS tenant_harden_guardian_audit_log ON guardian_audit_log;

DROP TRIGGER IF EXISTS tenant_harden_notifications ON notifications;
CREATE TRIGGER tenant_harden_notifications BEFORE INSERT OR UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fail-closed inserts for the high-risk legacy child tables.
-- ─────────────────────────────────────────────────────────────────────────────
DO $tenant$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'convoy_assignments','convoy_waypoints','convoy_seals','convoy_route_waypoints','checkpoints','trips','invoices','expenses',
    'driver_events','geofence_actions','sensor_logs','api_keys','documents',
    'fuel_logs','convoy_trucks','convoy_cfos','convoy_cfo_truck_assignments',
    'convoy_truck_photos','convoy_daily_reports','device_locations',
    'device_health','device_commands','field_reports','notifications'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(org_id)', 'idx_tenant_' || t, t);
    END IF;
  END LOOP;
END $tenant$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cross-tenant relationship invariants.
-- The org_id on a child row must agree with every tenant-bearing parent it
-- references. These checks prevent a tenant from binding an otherwise-valid
-- tenant-A row to a tenant-B user/device/vehicle by guessed UUID.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tenant_harden_validate_relationships() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE
  expected_org UUID;
  parent_org UUID;
BEGIN
  -- Convoy assignments: convoy + vehicle
  IF TG_TABLE_NAME = 'convoy_assignments' THEN
    SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;

  -- Shipments: convoy + vehicle + driver
  ELSIF TG_TABLE_NAME = 'shipments' THEN
    IF NEW.convoy_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.vehicle_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.driver_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM drivers WHERE id = NEW.driver_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  -- Trips: convoy + shipment + vehicle + driver
  ELSIF TG_TABLE_NAME = 'trips' THEN
    IF NEW.convoy_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.shipment_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM shipments WHERE id = NEW.shipment_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.driver_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM drivers WHERE id = NEW.driver_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  -- Invoice / expense secondary ownership
  ELSIF TG_TABLE_NAME = 'invoices' THEN
    IF NEW.shipment_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM shipments WHERE id = NEW.shipment_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.trip_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM trips WHERE id = NEW.trip_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'expenses' THEN
    IF NEW.trip_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM trips WHERE id = NEW.trip_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.vehicle_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.driver_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM drivers WHERE id = NEW.driver_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  -- Driver event: driver + vehicle + trip
  ELSIF TG_TABLE_NAME = 'driver_events' THEN
    IF NEW.driver_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM drivers WHERE id = NEW.driver_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.vehicle_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM vehicles WHERE id = NEW.vehicle_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.trip_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM trips WHERE id = NEW.trip_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  -- Communications
  ELSIF TG_TABLE_NAME = 'messages' THEN
    SELECT org_id INTO parent_org FROM channels WHERE id = NEW.channel_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.sender_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM users WHERE id = NEW.sender_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'channel_members' THEN
    SELECT org_id INTO parent_org FROM channels WHERE id = NEW.channel_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    SELECT org_id INTO parent_org FROM users WHERE id = NEW.user_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'message_attachments' THEN
    IF NEW.message_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM messages WHERE id = NEW.message_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    SELECT org_id INTO parent_org FROM users WHERE id = NEW.uploader_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;

  -- Cargo owner portal relationships
  ELSIF TG_TABLE_NAME = 'cargo_client_links' THEN
    SELECT org_id INTO parent_org FROM cargo_clients WHERE id = NEW.client_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.shipment_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM shipments WHERE id = NEW.shipment_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'client_notification_prefs' THEN
    SELECT org_id INTO parent_org FROM cargo_clients WHERE id = NEW.client_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.convoy_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'proof_of_delivery' THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.shipment_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM shipments WHERE id = NEW.shipment_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'portal_documents' THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;

  -- Guardian command / evidence graph
  ELSIF TG_TABLE_NAME = 'panic_events' THEN
    SELECT org_id INTO parent_org FROM guardian_devices WHERE id = NEW.device_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.resolved_by IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM users WHERE id = NEW.resolved_by;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'device_commands' THEN
    SELECT org_id INTO parent_org FROM guardian_devices WHERE id = NEW.device_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.issued_by IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM users WHERE id = NEW.issued_by;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'convoy_cfos' THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    SELECT org_id INTO parent_org FROM users WHERE id = NEW.cfo_user_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.guardian_device_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM guardian_devices WHERE id = NEW.guardian_device_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'convoy_cfo_truck_assignments' THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    SELECT org_id INTO parent_org FROM users WHERE id = NEW.cfo_user_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    SELECT org_id INTO parent_org FROM convoy_trucks WHERE id = NEW.convoy_truck_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;

  ELSIF TG_TABLE_NAME = 'convoy_truck_photos' THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    SELECT org_id INTO parent_org FROM convoy_trucks WHERE id = NEW.convoy_truck_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    SELECT org_id INTO parent_org FROM users WHERE id = NEW.cfo_user_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.guardian_device_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM guardian_devices WHERE id = NEW.guardian_device_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'convoy_handovers' THEN
    SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    IF NEW.convoy_truck_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM convoy_trucks WHERE id = NEW.convoy_truck_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
    IF NEW.handed_over_by_user_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM users WHERE id = NEW.handed_over_by_user_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'route_analyses' THEN
    IF NEW.convoy_id IS NOT NULL THEN
      SELECT org_id INTO parent_org FROM convoys WHERE id = NEW.convoy_id;
      IF parent_org IS NULL OR parent_org <> NEW.org_id THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
    END IF;
  END IF;

  RETURN NEW;
END $tenant$;

DROP TRIGGER IF EXISTS tenant_relationship_guard_convoy_assignments ON convoy_assignments;
CREATE TRIGGER tenant_relationship_guard_convoy_assignments AFTER INSERT OR UPDATE ON convoy_assignments
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_shipments ON shipments;
CREATE TRIGGER tenant_relationship_guard_shipments AFTER INSERT OR UPDATE ON shipments
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_trips ON trips;
CREATE TRIGGER tenant_relationship_guard_trips AFTER INSERT OR UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_invoices ON invoices;
CREATE TRIGGER tenant_relationship_guard_invoices AFTER INSERT OR UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_expenses ON expenses;
CREATE TRIGGER tenant_relationship_guard_expenses AFTER INSERT OR UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_driver_events ON driver_events;
CREATE TRIGGER tenant_relationship_guard_driver_events AFTER INSERT OR UPDATE ON driver_events
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_messages ON messages;
CREATE TRIGGER tenant_relationship_guard_messages AFTER INSERT OR UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_channel_members ON channel_members;
CREATE TRIGGER tenant_relationship_guard_channel_members AFTER INSERT OR UPDATE ON channel_members
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_message_attachments ON message_attachments;
CREATE TRIGGER tenant_relationship_guard_message_attachments AFTER INSERT OR UPDATE ON message_attachments
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_cargo_client_links ON cargo_client_links;
CREATE TRIGGER tenant_relationship_guard_cargo_client_links AFTER INSERT OR UPDATE ON cargo_client_links
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_client_notification_prefs ON client_notification_prefs;
CREATE TRIGGER tenant_relationship_guard_client_notification_prefs AFTER INSERT OR UPDATE ON client_notification_prefs
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_proof_of_delivery ON proof_of_delivery;
CREATE TRIGGER tenant_relationship_guard_proof_of_delivery AFTER INSERT OR UPDATE ON proof_of_delivery
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_portal_documents ON portal_documents;
CREATE TRIGGER tenant_relationship_guard_portal_documents AFTER INSERT OR UPDATE ON portal_documents
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_panic_events ON panic_events;
CREATE TRIGGER tenant_relationship_guard_panic_events AFTER INSERT OR UPDATE ON panic_events
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_device_commands ON device_commands;
CREATE TRIGGER tenant_relationship_guard_device_commands AFTER INSERT OR UPDATE ON device_commands
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_convoy_cfos ON convoy_cfos;
CREATE TRIGGER tenant_relationship_guard_convoy_cfos AFTER INSERT OR UPDATE ON convoy_cfos
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_convoy_cfo_truck_assignments ON convoy_cfo_truck_assignments;
CREATE TRIGGER tenant_relationship_guard_convoy_cfo_truck_assignments AFTER INSERT OR UPDATE ON convoy_cfo_truck_assignments
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_convoy_truck_photos ON convoy_truck_photos;
CREATE TRIGGER tenant_relationship_guard_convoy_truck_photos AFTER INSERT OR UPDATE ON convoy_truck_photos
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_convoy_handovers ON convoy_handovers;
CREATE TRIGGER tenant_relationship_guard_convoy_handovers AFTER INSERT OR UPDATE ON convoy_handovers
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

DROP TRIGGER IF EXISTS tenant_relationship_guard_route_analyses ON route_analyses;
CREATE TRIGGER tenant_relationship_guard_route_analyses AFTER INSERT OR UPDATE ON route_analyses
FOR EACH ROW EXECUTE FUNCTION tenant_harden_validate_relationships();

COMMIT;
