-- 20261002 tenant isolation reconciliation
-- Defense-in-depth: every tenant-bearing table must have a single RLS policy
-- keyed to app.current_org_id, and child records inherit org_id from their
-- authoritative parent when the application omits it.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add missing tenant columns and backfill from authoritative relationships.
-- Unresolvable legacy rows remain NULL and are therefore invisible to every
-- tenant-scoped session. They are never silently assigned to another tenant.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS sensor_logs ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE sensor_logs s
SET org_id = v.org_id
FROM vehicles v
WHERE s.vehicle_id = v.id AND s.org_id IS NULL;

ALTER TABLE IF EXISTS fuel_logs ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE fuel_logs f
SET org_id = v.org_id
FROM vehicles v
WHERE f.vehicle_id = v.id AND f.org_id IS NULL;

ALTER TABLE IF EXISTS driver_events ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE driver_events e
SET org_id = COALESCE(d.org_id, v.org_id)
FROM drivers d
FULL OUTER JOIN vehicles v ON v.id = e.vehicle_id
WHERE (d.id = e.driver_id OR e.driver_id IS NULL)
  AND e.org_id IS NULL
  AND COALESCE(d.org_id, v.org_id) IS NOT NULL;

ALTER TABLE IF EXISTS checkpoints ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE checkpoints cp
SET org_id = COALESCE(c.org_id, s.org_id)
FROM convoys c
LEFT JOIN shipments s ON s.id = cp.shipment_id
WHERE c.id = cp.convoy_id AND cp.org_id IS NULL;
UPDATE checkpoints cp
SET org_id = s.org_id
FROM shipments s
WHERE cp.shipment_id = s.id AND cp.org_id IS NULL;

ALTER TABLE IF EXISTS documents ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE documents d
SET org_id = c.org_id
FROM convoys c
WHERE d.convoy_id = c.id AND d.org_id IS NULL;

ALTER TABLE IF EXISTS geofence_actions ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE geofence_actions ga
SET org_id = g.org_id
FROM geofences g
WHERE ga.geofence_id = g.id AND ga.org_id IS NULL;

ALTER TABLE IF EXISTS devices ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE devices d
SET org_id = v.org_id
FROM vehicles v
WHERE d.vehicle_id = v.id AND d.org_id IS NULL;

ALTER TABLE IF EXISTS convoy_trucks ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE convoy_trucks ct
SET org_id = c.org_id
FROM convoys c
WHERE ct.convoy_id = c.id AND ct.org_id IS NULL;

ALTER TABLE IF EXISTS convoy_cfos ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE convoy_cfos cc
SET org_id = c.org_id
FROM convoys c
WHERE cc.convoy_id = c.id AND cc.org_id IS NULL;

ALTER TABLE IF EXISTS convoy_cfo_truck_assignments ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE convoy_cfo_truck_assignments a
SET org_id = c.org_id
FROM convoys c
WHERE a.convoy_id = c.id AND a.org_id IS NULL;

ALTER TABLE IF EXISTS convoy_truck_photos ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE convoy_truck_photos p
SET org_id = c.org_id
FROM convoys c
WHERE p.convoy_id = c.id AND p.org_id IS NULL;

ALTER TABLE IF EXISTS convoy_daily_reports ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE convoy_daily_reports r
SET org_id = c.org_id
FROM convoys c
WHERE r.convoy_id = c.id AND r.org_id IS NULL;

ALTER TABLE IF EXISTS device_locations ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE device_locations dl
SET org_id = gd.org_id
FROM guardian_devices gd
WHERE dl.device_id = gd.id AND dl.org_id IS NULL;

ALTER TABLE IF EXISTS device_health ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE device_health dh
SET org_id = gd.org_id
FROM guardian_devices gd
WHERE dh.device_id = gd.id AND dh.org_id IS NULL;

ALTER TABLE IF EXISTS device_commands ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE device_commands dc
SET org_id = gd.org_id
FROM guardian_devices gd
WHERE dc.device_id = gd.id AND dc.org_id IS NULL;

ALTER TABLE IF EXISTS field_reports ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE field_reports fr
SET org_id = gd.org_id
FROM guardian_devices gd
WHERE fr.device_id = gd.id AND fr.org_id IS NULL;

ALTER TABLE IF EXISTS guardian_audit_log ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE guardian_audit_log al
SET org_id = u.org_id
FROM users u
WHERE al.actor_id = u.id AND al.org_id IS NULL;

ALTER TABLE IF EXISTS api_keys ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE api_keys k
SET org_id = u.org_id
FROM users u
WHERE k.org_id IS NULL AND k.created_by = u.id;

ALTER TABLE IF EXISTS audit_logs ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE audit_logs a
SET org_id = u.org_id
FROM users u
WHERE a.user_id = u.id AND a.org_id IS NULL;

-- These are small, high-risk credential/control tables.
ALTER TABLE IF EXISTS cfo_login_attempts ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE cfo_login_attempts ca
SET org_id = gd.org_id
FROM guardian_devices gd
WHERE ca.device_id = gd.id AND ca.org_id IS NULL;

ALTER TABLE IF EXISTS guardian_command_nonces ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE guardian_command_nonces n
SET org_id = gd.org_id
FROM guardian_devices gd
WHERE n.device_id = gd.id AND n.org_id IS NULL;

ALTER TABLE IF EXISTS convoy_codes ADD COLUMN IF NOT EXISTS org_id UUID;
UPDATE convoy_codes cc
SET org_id = c.org_id
FROM convoys c
WHERE cc.convoy_code IS NOT NULL AND c.id::text = cc.convoy_code AND cc.org_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Parent-derived org triggers. These turn missing org_id into a DB-side
-- invariant and prevent cross-tenant foreign-key attachment even when a route
-- forgets the column.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_set_org_from_vehicle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM vehicles WHERE id = NEW.vehicle_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_vehicle'; END IF;
  NEW.org_id := v_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tenant_set_org_from_convoy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM convoys WHERE id = NEW.convoy_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_convoy'; END IF;
  NEW.org_id := v_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tenant_set_org_from_device() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM guardian_devices WHERE id = NEW.device_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_device'; END IF;
  NEW.org_id := v_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tenant_set_org_from_geofence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM geofences WHERE id = NEW.geofence_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_geofence'; END IF;
  NEW.org_id := v_org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION tenant_set_org_from_user() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM users WHERE id = NEW.user_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_user'; END IF;
  NEW.org_id := v_org;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenant_org_sensor_logs ON sensor_logs;
CREATE TRIGGER tenant_org_sensor_logs BEFORE INSERT OR UPDATE ON sensor_logs
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_vehicle();

DROP TRIGGER IF EXISTS tenant_org_fuel_logs ON fuel_logs;
CREATE TRIGGER tenant_org_fuel_logs BEFORE INSERT OR UPDATE ON fuel_logs
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_vehicle();

DROP TRIGGER IF EXISTS tenant_org_documents ON documents;
CREATE TRIGGER tenant_org_documents BEFORE INSERT OR UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_org_geofence_actions ON geofence_actions;
CREATE TRIGGER tenant_org_geofence_actions BEFORE INSERT OR UPDATE ON geofence_actions
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_geofence();

DROP TRIGGER IF EXISTS tenant_org_convoy_trucks ON convoy_trucks;
CREATE TRIGGER tenant_org_convoy_trucks BEFORE INSERT OR UPDATE ON convoy_trucks
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_org_convoy_cfos ON convoy_cfos;
CREATE TRIGGER tenant_org_convoy_cfos BEFORE INSERT OR UPDATE ON convoy_cfos
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_org_cfo_assignments ON convoy_cfo_truck_assignments;
CREATE TRIGGER tenant_org_cfo_assignments BEFORE INSERT OR UPDATE ON convoy_cfo_truck_assignments
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_org_convoy_photos ON convoy_truck_photos;
CREATE TRIGGER tenant_org_convoy_photos BEFORE INSERT OR UPDATE ON convoy_truck_photos
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_org_daily_reports ON convoy_daily_reports;
CREATE TRIGGER tenant_org_daily_reports BEFORE INSERT OR UPDATE ON convoy_daily_reports
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_convoy();

DROP TRIGGER IF EXISTS tenant_org_device_locations ON device_locations;
CREATE TRIGGER tenant_org_device_locations BEFORE INSERT OR UPDATE ON device_locations
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_device();

DROP TRIGGER IF EXISTS tenant_org_device_health ON device_health;
CREATE TRIGGER tenant_org_device_health BEFORE INSERT OR UPDATE ON device_health
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_device();

DROP TRIGGER IF EXISTS tenant_org_device_commands ON device_commands;
CREATE TRIGGER tenant_org_device_commands BEFORE INSERT OR UPDATE ON device_commands
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_device();

DROP TRIGGER IF EXISTS tenant_org_field_reports ON field_reports;
CREATE TRIGGER tenant_org_field_reports BEFORE INSERT OR UPDATE ON field_reports
FOR EACH ROW EXECUTE FUNCTION tenant_set_org_from_device();

-- ---------------------------------------------------------------------------
-- 3. Tenant policy reconciliation.
-- Drop ALL existing policies first: PostgreSQL ORs permissive policies, so
-- leaving an older permissive policy in place can silently re-open a table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl TEXT;
  pol RECORD;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users','vehicles','convoys','alerts','incidents','gps_logs','drivers',
    'shipments','trips','invoices','expenses','maintenance_records','risk_zones',
    'geofences','geofence_events','convoy_route_corridors','fuel_entries',
    'fuel_anomalies','approved_fuel_stations','reports','proof_of_delivery',
    'portal_documents','cargo_clients','cargo_client_links','client_magic_links',
    'client_notification_prefs','channels','channel_members','messages',
    'message_attachments','message_reactions','pinned_messages','shifts',
    'custody_events','sync_devices','sync_operations','sync_conflicts',
    'sync_change_log','telemetry_ingest_keys','email_notifications',
    'email_routing_policies','cds_customers','cds_transporters','cds_vehicles',
    'cds_drivers','cds_containers','cds_electronic_locks','cds_lock_events',
    'cds_bookings','cds_trips','cds_trip_events','cds_gps_history',
    'cds_geofences','cds_alerts','cds_incidents','cds_documents',
    'cds_notifications','cds_audit_logs','cds_activity_feed','cds_reports',
    'spatial_events','route_analyses','risk_events','driver_behaviour_events',
    'rules','rule_versions','rule_executions','field_devices',
    'field_agent_pins','field_sessions','offline_*','sensor_logs','fuel_logs',
    'devices','documents','geofence_actions','convoy_trucks','convoy_cfos',
    'convoy_cfo_truck_assignments','convoy_truck_photos','convoy_daily_reports',
    'device_locations','device_health','device_commands','field_reports',
    'guardian_audit_log','cfo_login_attempts','guardian_command_nonces','api_keys',
    'audit_logs','checkpoints'
  ] LOOP
    IF tbl LIKE 'offline_%' THEN
      CONTINUE;
    END IF;
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tbl AND column_name='org_id'
    ) THEN CONTINUE; END IF;

    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=tbl LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

    IF tbl = 'risk_zones' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid OR org_id IS NULL) WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
        tbl
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid) WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
        tbl
      );
    END IF;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO sonalit_app', tbl);
  END LOOP;
END $$;

-- Do not accidentally turn service-wide diagnostics/configuration into a
-- tenant table through the generic reconciliation above. Diagnostics are made
-- tenant-aware at the application boundary in the same security patch.
ALTER TABLE IF EXISTS runtime_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS runtime_diagnostics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON runtime_diagnostics;
CREATE POLICY tenant_isolation ON runtime_diagnostics
  USING (
    org_id IS NOT NULL
    AND org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  )
  WITH CHECK (
    org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
  );

COMMIT;
