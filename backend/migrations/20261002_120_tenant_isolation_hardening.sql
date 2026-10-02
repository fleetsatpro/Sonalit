-- Tenant isolation hardening — canonical reconciliation
-- Idempotent. Run after the existing application schema migrations.
BEGIN;

-- 1. Add org_id only where the table exists; never make schema bootstrap
-- depend on optional legacy tables that were created by one-off scripts.
DO $tenant$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sensor_logs','fuel_logs','driver_events','checkpoints','documents',
    'geofence_actions','devices','convoy_assignments','convoy_waypoints',
    'convoy_route_waypoints','convoy_seals','convoy_trucks','convoy_cfos',
    'convoy_cfo_truck_assignments','convoy_truck_photos','convoy_daily_reports',
    'device_locations','device_health','device_commands','field_reports',
    'guardian_audit_log','guardian_captures','guardian_voice_messages',
    'guardian_capture_events','officer_activity_events','knox_remote_sessions',
    'cfo_login_attempts','guardian_command_nonces','device_command_events',
    'api_keys','notifications','audit_logs'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=t AND column_name='org_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN org_id UUID', t);
    END IF;
  END LOOP;
END $tenant$;

-- 2. Backfill from authoritative parent ownership. Ambiguous/unresolved rows
-- deliberately remain NULL and become invisible to tenant sessions.
DO $tenant$
BEGIN
  IF to_regclass('public.sensor_logs') IS NOT NULL THEN
    UPDATE sensor_logs s SET org_id=v.org_id FROM vehicles v
     WHERE s.vehicle_id=v.id AND s.org_id IS NULL AND v.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.fuel_logs') IS NOT NULL THEN
    UPDATE fuel_logs f SET org_id=v.org_id FROM vehicles v
     WHERE f.vehicle_id=v.id AND f.org_id IS NULL AND v.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.driver_events') IS NOT NULL THEN
    UPDATE driver_events e SET org_id=d.org_id FROM drivers d
     WHERE e.driver_id=d.id AND e.org_id IS NULL AND d.org_id IS NOT NULL;
    UPDATE driver_events e SET org_id=v.org_id FROM vehicles v
     WHERE e.vehicle_id=v.id AND e.org_id IS NULL AND v.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.checkpoints') IS NOT NULL THEN
    UPDATE checkpoints x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
    UPDATE checkpoints x SET org_id=s.org_id FROM shipments s
     WHERE x.shipment_id=s.id AND x.org_id IS NULL AND s.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.documents') IS NOT NULL THEN
    UPDATE documents x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.geofence_actions') IS NOT NULL THEN
    UPDATE geofence_actions x SET org_id=g.org_id FROM geofences g
     WHERE x.geofence_id=g.id AND x.org_id IS NULL AND g.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.devices') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='devices' AND column_name='vehicle_id') THEN
    UPDATE devices x SET org_id=v.org_id FROM vehicles v
     WHERE x.vehicle_id=v.id AND x.org_id IS NULL AND v.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_assignments') IS NOT NULL THEN
    UPDATE convoy_assignments x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_waypoints') IS NOT NULL THEN
    UPDATE convoy_waypoints x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_route_waypoints') IS NOT NULL THEN
    UPDATE convoy_route_waypoints x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_seals') IS NOT NULL THEN
    UPDATE convoy_seals x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_trucks') IS NOT NULL THEN
    UPDATE convoy_trucks x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_cfos') IS NOT NULL THEN
    UPDATE convoy_cfos x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_cfo_truck_assignments') IS NOT NULL THEN
    UPDATE convoy_cfo_truck_assignments x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_truck_photos') IS NOT NULL THEN
    UPDATE convoy_truck_photos x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.convoy_daily_reports') IS NOT NULL THEN
    UPDATE convoy_daily_reports x SET org_id=c.org_id FROM convoys c
     WHERE x.convoy_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.device_locations') IS NOT NULL THEN
    UPDATE device_locations x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.device_health') IS NOT NULL THEN
    UPDATE device_health x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.device_commands') IS NOT NULL THEN
    UPDATE device_commands x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.field_reports') IS NOT NULL THEN
    UPDATE field_reports x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.guardian_captures') IS NOT NULL THEN
    UPDATE guardian_captures x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.guardian_voice_messages') IS NOT NULL THEN
    UPDATE guardian_voice_messages x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.guardian_capture_events') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guardian_capture_events' AND column_name='device_id') THEN
    UPDATE guardian_capture_events x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.cfo_login_attempts') IS NOT NULL THEN
    UPDATE cfo_login_attempts x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.guardian_command_nonces') IS NOT NULL THEN
    UPDATE guardian_command_nonces x SET org_id=d.org_id FROM guardian_devices d
     WHERE x.device_id=d.id AND x.org_id IS NULL AND d.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.device_command_events') IS NOT NULL THEN
    UPDATE device_command_events x SET org_id=c.org_id FROM device_commands c
     WHERE x.command_id=c.id AND x.org_id IS NULL AND c.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.guardian_audit_log') IS NOT NULL THEN
    UPDATE guardian_audit_log x SET org_id=u.org_id FROM users u
     WHERE x.actor_id=u.id AND x.org_id IS NULL AND u.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    UPDATE notifications x SET org_id=u.org_id FROM users u
     WHERE x.user_id=u.id AND x.org_id IS NULL AND u.org_id IS NOT NULL;
  END IF;
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    UPDATE audit_logs x SET org_id=u.org_id FROM users u
     WHERE x.user_id=u.id AND x.org_id IS NULL AND u.org_id IS NOT NULL;
  END IF;
END $tenant$;

-- 3. Parent-derived org triggers for legacy child tables.
CREATE OR REPLACE FUNCTION tenant_harden_from_vehicle() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE p UUID;
BEGIN
  IF NEW.vehicle_id IS NULL THEN p := NULLIF(current_setting('app.current_org_id', true), '')::uuid;
  ELSE SELECT org_id INTO p FROM vehicles WHERE id=NEW.vehicle_id; END IF;
  IF p IS NULL THEN RAISE EXCEPTION 'tenant_scope_required'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id<>p THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
  NEW.org_id:=p; RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_from_convoy() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE p UUID;
BEGIN
  IF NEW.convoy_id IS NULL THEN p := NULLIF(current_setting('app.current_org_id', true), '')::uuid;
  ELSE SELECT org_id INTO p FROM convoys WHERE id=NEW.convoy_id; END IF;
  IF p IS NULL THEN RAISE EXCEPTION 'tenant_scope_required'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id<>p THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
  NEW.org_id:=p; RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_from_device() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE p UUID;
BEGIN
  SELECT org_id INTO p FROM guardian_devices WHERE id=NEW.device_id;
  IF p IS NULL THEN RAISE EXCEPTION 'tenant_scope_required'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id<>p THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
  NEW.org_id:=p; RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_from_geofence() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE p UUID;
BEGIN
  SELECT org_id INTO p FROM geofences WHERE id=NEW.geofence_id;
  IF p IS NULL THEN RAISE EXCEPTION 'tenant_scope_required'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id<>p THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
  NEW.org_id:=p; RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_from_command_event() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE p UUID;
BEGIN
  SELECT org_id INTO p FROM device_commands WHERE id=NEW.command_id;
  IF p IS NULL THEN RAISE EXCEPTION 'tenant_scope_required'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id<>p THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
  NEW.org_id:=p; RETURN NEW;
END $tenant$;

CREATE OR REPLACE FUNCTION tenant_harden_from_user() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE p UUID;
BEGIN
  IF NEW.user_id IS NULL THEN p := NULLIF(current_setting('app.current_org_id', true), '')::uuid;
  ELSE SELECT org_id INTO p FROM users WHERE id=NEW.user_id; END IF;
  IF p IS NULL THEN RAISE EXCEPTION 'tenant_scope_required'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id<>p THEN RAISE EXCEPTION 'tenant_scope_parent_mismatch'; END IF;
  NEW.org_id:=p; RETURN NEW;
END $tenant$;

DO $tenant$
BEGIN
  IF to_regclass('public.sensor_logs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_sensor_logs ON sensor_logs;
    CREATE TRIGGER tenant_scope_sensor_logs BEFORE INSERT OR UPDATE ON sensor_logs FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_vehicle();
  END IF;
  IF to_regclass('public.fuel_logs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_fuel_logs ON fuel_logs;
    CREATE TRIGGER tenant_scope_fuel_logs BEFORE INSERT OR UPDATE ON fuel_logs FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_vehicle();
  END IF;
  IF to_regclass('public.documents') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_documents ON documents;
    CREATE TRIGGER tenant_scope_documents BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.geofence_actions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_geofence_actions ON geofence_actions;
    CREATE TRIGGER tenant_scope_geofence_actions BEFORE INSERT OR UPDATE ON geofence_actions FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_geofence();
  END IF;
  IF to_regclass('public.convoy_assignments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_assignments ON convoy_assignments;
    CREATE TRIGGER tenant_scope_convoy_assignments BEFORE INSERT OR UPDATE ON convoy_assignments FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.convoy_waypoints') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_waypoints ON convoy_waypoints;
    CREATE TRIGGER tenant_scope_convoy_waypoints BEFORE INSERT OR UPDATE ON convoy_waypoints FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.convoy_route_waypoints') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_route_waypoints ON convoy_route_waypoints;
    CREATE TRIGGER tenant_scope_convoy_route_waypoints BEFORE INSERT OR UPDATE ON convoy_route_waypoints FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.convoy_seals') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_seals ON convoy_seals;
    CREATE TRIGGER tenant_scope_convoy_seals BEFORE INSERT OR UPDATE ON convoy_seals FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.convoy_trucks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_trucks ON convoy_trucks;
    CREATE TRIGGER tenant_scope_convoy_trucks BEFORE INSERT OR UPDATE ON convoy_trucks FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.convoy_cfos') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_cfos ON convoy_cfos;
    CREATE TRIGGER tenant_scope_convoy_cfos BEFORE INSERT OR UPDATE ON convoy_cfos FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.convoy_cfo_truck_assignments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_cfo_assignments ON convoy_cfo_truck_assignments;
    CREATE TRIGGER tenant_scope_convoy_cfo_assignments BEFORE INSERT OR UPDATE ON convoy_cfo_truck_assignments FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.convoy_truck_photos') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_truck_photos ON convoy_truck_photos;
    CREATE TRIGGER tenant_scope_convoy_truck_photos BEFORE INSERT OR UPDATE ON convoy_truck_photos FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.convoy_daily_reports') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_convoy_daily_reports ON convoy_daily_reports;
    CREATE TRIGGER tenant_scope_convoy_daily_reports BEFORE INSERT OR UPDATE ON convoy_daily_reports FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_convoy();
  END IF;
  IF to_regclass('public.device_locations') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_device_locations ON device_locations;
    CREATE TRIGGER tenant_scope_device_locations BEFORE INSERT OR UPDATE ON device_locations FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_device();
  END IF;
  IF to_regclass('public.device_health') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_device_health ON device_health;
    CREATE TRIGGER tenant_scope_device_health BEFORE INSERT OR UPDATE ON device_health FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_device();
  END IF;
  IF to_regclass('public.device_commands') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_device_commands ON device_commands;
    CREATE TRIGGER tenant_scope_device_commands BEFORE INSERT OR UPDATE ON device_commands FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_device();
  END IF;
  IF to_regclass('public.field_reports') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_field_reports ON field_reports;
    CREATE TRIGGER tenant_scope_field_reports BEFORE INSERT OR UPDATE ON field_reports FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_device();
  END IF;
  IF to_regclass('public.guardian_captures') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_guardian_captures ON guardian_captures;
    CREATE TRIGGER tenant_scope_guardian_captures BEFORE INSERT OR UPDATE ON guardian_captures FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_device();
  END IF;
  IF to_regclass('public.guardian_voice_messages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_guardian_voice_messages ON guardian_voice_messages;
    CREATE TRIGGER tenant_scope_guardian_voice_messages BEFORE INSERT OR UPDATE ON guardian_voice_messages FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_device();
  END IF;
  IF to_regclass('public.cfo_login_attempts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_cfo_login_attempts ON cfo_login_attempts;
    CREATE TRIGGER tenant_scope_cfo_login_attempts BEFORE INSERT OR UPDATE ON cfo_login_attempts FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_device();
  END IF;
  IF to_regclass('public.guardian_command_nonces') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_guardian_command_nonces ON guardian_command_nonces;
    CREATE TRIGGER tenant_scope_guardian_command_nonces BEFORE INSERT OR UPDATE ON guardian_command_nonces FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_device();
  END IF;
  IF to_regclass('public.device_command_events') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_device_command_events ON device_command_events;
    CREATE TRIGGER tenant_scope_device_command_events BEFORE INSERT OR UPDATE ON device_command_events FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_command_event();
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS tenant_scope_notifications ON notifications;
    CREATE TRIGGER tenant_scope_notifications BEFORE INSERT OR UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION tenant_harden_from_user();
  END IF;
END $tenant$;

-- 4. Cross-tenant parent relationship guard.
-- RLS answers "which rows may this tenant see?" This layer answers the
-- complementary question "may this tenant row point at this parent?" A row with
-- org=A and a foreign key to a parent with org=B is a mixed-tenant record even
-- though both rows are individually protected. Reject it at the database edge.
CREATE OR REPLACE FUNCTION tenant_assert_parent_org(
  parent_table TEXT,
  parent_id UUID,
  expected_org UUID
) RETURNS VOID
LANGUAGE plpgsql AS $tenant_parent$
DECLARE
  actual_org UUID;
BEGIN
  IF parent_id IS NULL THEN RETURN; END IF;
  EXECUTE format('SELECT org_id FROM public.%I WHERE id=$1', parent_table)
    INTO actual_org
    USING parent_id;
  IF actual_org IS NULL OR expected_org IS NULL OR actual_org <> expected_org THEN
    RAISE EXCEPTION 'tenant_scope_parent_mismatch';
  END IF;
END $tenant_parent$;

CREATE OR REPLACE FUNCTION tenant_relationship_guard() RETURNS trigger
LANGUAGE plpgsql AS $tenant_rel$
DECLARE
  org UUID := NULLIF(to_jsonb(NEW)->>'org_id','')::uuid;
  id UUID;
BEGIN
  IF org IS NULL THEN
    RAISE EXCEPTION 'tenant_scope_missing';
  END IF;

  IF TG_TABLE_NAME='convoy_assignments' THEN
    id := NULLIF(to_jsonb(NEW)->>'vehicle_id','')::uuid;
    PERFORM tenant_assert_parent_org('vehicles', id, org);

  ELSIF TG_TABLE_NAME='shipments' THEN
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);
    id := NULLIF(to_jsonb(NEW)->>'vehicle_id','')::uuid;
    PERFORM tenant_assert_parent_org('vehicles', id, org);
    id := NULLIF(to_jsonb(NEW)->>'driver_id','')::uuid;
    PERFORM tenant_assert_parent_org('drivers', id, org);

  ELSIF TG_TABLE_NAME='checkpoints' THEN
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);
    id := NULLIF(to_jsonb(NEW)->>'shipment_id','')::uuid;
    PERFORM tenant_assert_parent_org('shipments', id, org);

  ELSIF TG_TABLE_NAME='trips' THEN
    id := NULLIF(to_jsonb(NEW)->>'vehicle_id','')::uuid;
    PERFORM tenant_assert_parent_org('vehicles', id, org);
    id := NULLIF(to_jsonb(NEW)->>'driver_id','')::uuid;
    PERFORM tenant_assert_parent_org('drivers', id, org);
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);
    id := NULLIF(to_jsonb(NEW)->>'shipment_id','')::uuid;
    PERFORM tenant_assert_parent_org('shipments', id, org);

  ELSIF TG_TABLE_NAME='invoices' THEN
    id := NULLIF(to_jsonb(NEW)->>'shipment_id','')::uuid;
    PERFORM tenant_assert_parent_org('shipments', id, org);
    id := NULLIF(to_jsonb(NEW)->>'trip_id','')::uuid;
    PERFORM tenant_assert_parent_org('trips', id, org);

  ELSIF TG_TABLE_NAME='expenses' THEN
    id := NULLIF(to_jsonb(NEW)->>'trip_id','')::uuid;
    PERFORM tenant_assert_parent_org('trips', id, org);
    id := NULLIF(to_jsonb(NEW)->>'vehicle_id','')::uuid;
    PERFORM tenant_assert_parent_org('vehicles', id, org);
    id := NULLIF(to_jsonb(NEW)->>'driver_id','')::uuid;
    PERFORM tenant_assert_parent_org('drivers', id, org);

  ELSIF TG_TABLE_NAME='driver_events' THEN
    id := NULLIF(to_jsonb(NEW)->>'driver_id','')::uuid;
    PERFORM tenant_assert_parent_org('drivers', id, org);
    id := NULLIF(to_jsonb(NEW)->>'vehicle_id','')::uuid;
    PERFORM tenant_assert_parent_org('vehicles', id, org);
    id := NULLIF(to_jsonb(NEW)->>'trip_id','')::uuid;
    PERFORM tenant_assert_parent_org('trips', id, org);

  ELSIF TG_TABLE_NAME='messages' THEN
    id := NULLIF(to_jsonb(NEW)->>'channel_id','')::uuid;
    PERFORM tenant_assert_parent_org('channels', id, org);
    id := NULLIF(to_jsonb(NEW)->>'sender_id','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);

  ELSIF TG_TABLE_NAME='channel_members' THEN
    id := NULLIF(to_jsonb(NEW)->>'channel_id','')::uuid;
    PERFORM tenant_assert_parent_org('channels', id, org);
    id := NULLIF(to_jsonb(NEW)->>'user_id','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);

  ELSIF TG_TABLE_NAME='message_attachments' THEN
    id := NULLIF(to_jsonb(NEW)->>'message_id','')::uuid;
    PERFORM tenant_assert_parent_org('messages', id, org);
    id := NULLIF(to_jsonb(NEW)->>'uploader_id','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);

  ELSIF TG_TABLE_NAME='message_reactions' THEN
    id := NULLIF(to_jsonb(NEW)->>'message_id','')::uuid;
    PERFORM tenant_assert_parent_org('messages', id, org);
    id := NULLIF(to_jsonb(NEW)->>'user_id','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);

  ELSIF TG_TABLE_NAME='pinned_messages' THEN
    id := NULLIF(to_jsonb(NEW)->>'channel_id','')::uuid;
    PERFORM tenant_assert_parent_org('channels', id, org);
    id := NULLIF(to_jsonb(NEW)->>'message_id','')::uuid;
    PERFORM tenant_assert_parent_org('messages', id, org);
    id := NULLIF(to_jsonb(NEW)->>'pinned_by','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);

  ELSIF TG_TABLE_NAME='cargo_client_links' THEN
    id := NULLIF(to_jsonb(NEW)->>'client_id','')::uuid;
    PERFORM tenant_assert_parent_org('cargo_clients', id, org);
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);
    id := NULLIF(to_jsonb(NEW)->>'shipment_id','')::uuid;
    PERFORM tenant_assert_parent_org('shipments', id, org);

  ELSIF TG_TABLE_NAME='client_notification_prefs' THEN
    id := NULLIF(to_jsonb(NEW)->>'client_id','')::uuid;
    PERFORM tenant_assert_parent_org('cargo_clients', id, org);
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);

  ELSIF TG_TABLE_NAME='convoy_cfos' THEN
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);
    id := NULLIF(to_jsonb(NEW)->>'cfo_user_id','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);
    id := NULLIF(to_jsonb(NEW)->>'guardian_device_id','')::uuid;
    PERFORM tenant_assert_parent_org('guardian_devices', id, org);

  ELSIF TG_TABLE_NAME='convoy_cfo_truck_assignments' THEN
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);
    id := NULLIF(to_jsonb(NEW)->>'cfo_user_id','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);
    id := NULLIF(to_jsonb(NEW)->>'convoy_truck_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoy_trucks', id, org);

  ELSIF TG_TABLE_NAME='convoy_truck_photos' THEN
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);
    id := NULLIF(to_jsonb(NEW)->>'convoy_truck_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoy_trucks', id, org);
    id := NULLIF(to_jsonb(NEW)->>'cfo_user_id','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);

  ELSIF TG_TABLE_NAME='convoy_handovers' OR TG_TABLE_NAME='route_analyses' THEN
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);

  ELSIF TG_TABLE_NAME='officer_activity_events' THEN
    id := NULLIF(to_jsonb(NEW)->>'officer_id','')::uuid;
    PERFORM tenant_assert_parent_org('field_officers', id, org);
    id := NULLIF(to_jsonb(NEW)->>'convoy_id','')::uuid;
    PERFORM tenant_assert_parent_org('convoys', id, org);

  ELSIF TG_TABLE_NAME='knox_remote_sessions' THEN
    id := NULLIF(to_jsonb(NEW)->>'device_id','')::uuid;
    PERFORM tenant_assert_parent_org('guardian_devices', id, org);
    id := NULLIF(to_jsonb(NEW)->>'operator_id','')::uuid;
    PERFORM tenant_assert_parent_org('users', id, org);
    id := NULLIF(to_jsonb(NEW)->>'officer_id','')::uuid;
    PERFORM tenant_assert_parent_org('field_officers', id, org);

  ELSIF TG_TABLE_NAME='panic_events' OR TG_TABLE_NAME='device_commands'
        OR TG_TABLE_NAME='field_reports' OR TG_TABLE_NAME='guardian_captures'
        OR TG_TABLE_NAME='guardian_voice_messages' THEN
    id := NULLIF(to_jsonb(NEW)->>'device_id','')::uuid;
    PERFORM tenant_assert_parent_org('guardian_devices', id, org);

  ELSIF TG_TABLE_NAME='device_command_events' THEN
    id := NULLIF(to_jsonb(NEW)->>'command_id','')::uuid;
    PERFORM tenant_assert_parent_org('device_commands', id, org);

  END IF;

  RETURN NEW;
END $tenant_rel$;

DO $tenant_attach$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'convoy_assignments','shipments','checkpoints','trips','invoices','expenses','driver_events',
    'messages','channel_members','message_attachments','message_reactions','pinned_messages',
    'cargo_client_links','client_notification_prefs','convoy_cfos','convoy_cfo_truck_assignments',
    'convoy_truck_photos','convoy_handovers','route_analyses','officer_activity_events',
    'knox_remote_sessions','panic_events','device_commands','field_reports','guardian_captures',
    'guardian_voice_messages','device_command_events'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=t AND column_name='org_id'
       ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS tenant_relationship_guard ON public.%I', t);
      EXECUTE format(
        'CREATE CONSTRAINT TRIGGER tenant_relationship_guard
         AFTER INSERT OR UPDATE ON public.%I
         DEFERRABLE INITIALLY IMMEDIATE
         FOR EACH ROW EXECUTE FUNCTION tenant_relationship_guard()',
        t
      );
    END IF;
  END LOOP;
END $tenant_attach$;

-- 4. Shared/global intelligence: risk_zones NULL-org rows remain readable
-- but tenant sessions cannot modify or delete those global rows.
-- 4. Shared/global intelligence: risk_zones NULL org rows remain readable,
-- but tenant sessions cannot modify or delete those global rows.
DO $tenant$
DECLARE
  r RECORD;
  p RECORD;
  bootstrap CONSTANT TEXT[] := ARRAY['users','guardian_devices','portal_tokens','cargo_clients','client_magic_links','telemetry_ingest_keys','tracking_qr_codes','tracking_sessions','field_devices','field_sessions','field_agent_pins','enrollment_codes','convoy_codes'];
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'runtime_diagnostics'
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='org_id' AND NOT a.attisdropped)
  LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname=r.schema_name AND tablename=r.table_name AND policyname IN ('tenant_isolation_hardening','tenant_isolation_hardening_insert','tenant_isolation_hardening_update','tenant_isolation_hardening_delete','tenant_global_risk_read') LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, r.schema_name, r.table_name);
    END LOOP;
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schema_name, r.table_name);
    IF NOT (r.table_name = ANY(bootstrap)) THEN
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.schema_name, r.table_name);
    END IF;
    IF r.table_name='risk_zones' THEN
      EXECUTE format('CREATE POLICY tenant_isolation_hardening ON %I.%I AS RESTRICTIVE FOR SELECT USING (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid OR org_id IS NULL)', r.schema_name,r.table_name);
      EXECUTE format('CREATE POLICY tenant_isolation_hardening_insert ON %I.%I AS RESTRICTIVE FOR INSERT WITH CHECK (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid)', r.schema_name,r.table_name);
      EXECUTE format('CREATE POLICY tenant_isolation_hardening_update ON %I.%I AS RESTRICTIVE FOR UPDATE USING (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid) WITH CHECK (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid)', r.schema_name,r.table_name);
      EXECUTE format('CREATE POLICY tenant_isolation_hardening_delete ON %I.%I AS RESTRICTIVE FOR DELETE USING (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid)', r.schema_name,r.table_name);
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation_hardening ON %I.%I AS RESTRICTIVE FOR ALL USING (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid) WITH CHECK (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid)', r.schema_name,r.table_name);
    END IF;

    -- A restrictive policy cannot grant access on its own. Only add a broad
    -- tenant-scoped permissive base when the table has no existing permissive
    -- policy, so established role/resource policies are preserved exactly.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname=r.schema_name
         AND tablename=r.table_name
         AND permissive='PERMISSIVE'
    ) THEN
      IF r.table_name='risk_zones' THEN
        EXECUTE format('CREATE POLICY tenant_base_fallback ON %I.%I AS PERMISSIVE FOR ALL USING (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid OR org_id IS NULL) WITH CHECK (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid)', r.schema_name,r.table_name);
      ELSE
        EXECUTE format('CREATE POLICY tenant_base_fallback ON %I.%I AS PERMISSIVE FOR ALL USING (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid) WITH CHECK (org_id=NULLIF(current_setting(''app.current_org_id'',true),'''')::uuid)', r.schema_name,r.table_name);
      END IF;
    END IF;
    BEGIN
      IF pg_get_serial_sequence(format('%I.%I',r.schema_name,r.table_name),'id') IS NOT NULL THEN
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO sonalit_app', pg_get_serial_sequence(format('%I.%I',r.schema_name,r.table_name),'id'));
      END IF;
    EXCEPTION WHEN undefined_object OR invalid_parameter_value THEN NULL;
    END;
  END LOOP;
END $tenant$;

-- 5. Runtime diagnostics intentionally stays service-wide for writers; its
-- admin API is tenant-filtered by backend/src/routes/runtimeDiagnostics.js.
COMMIT;
