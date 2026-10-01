
DROP TRIGGER IF EXISTS tenant_harden_field_reports ON field_reports;
CREATE TRIGGER tenant_harden_field_reports BEFORE INSERT OR UPDATE ON field_reports
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_guardian_captures ON guardian_captures;
CREATE TRIGGER tenant_harden_guardian_captures BEFORE INSERT OR UPDATE ON guardian_captures
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_guardian_voice_messages ON guardian_voice_messages;
CREATE TRIGGER tenant_harden_guardian_voice_messages BEFORE INSERT OR UPDATE ON guardian_voice_messages
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_command_nonces ON guardian_command_nonces;
CREATE OR REPLACE FUNCTION tenant_harden_org_from_command_event() RETURNS trigger
LANGUAGE plpgsql AS $tenant$
DECLARE parent_org UUID;
BEGIN
  SELECT org_id INTO parent_org FROM device_commands WHERE id = NEW.command_id;
  IF parent_org IS NULL THEN RAISE EXCEPTION 'tenant_scope_missing_command'; END IF;
  IF NEW.org_id IS NOT NULL AND NEW.org_id <> parent_org THEN RAISE EXCEPTION 'tenant_scope_mismatch'; END IF;
  NEW.org_id := parent_org;
  RETURN NEW;
END $tenant$;

CREATE TRIGGER tenant_harden_command_nonces BEFORE INSERT OR UPDATE ON guardian_command_nonces
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_cfo_login_attempts ON cfo_login_attempts;
CREATE TRIGGER tenant_harden_cfo_login_attempts BEFORE INSERT OR UPDATE ON cfo_login_attempts
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

DROP TRIGGER IF EXISTS tenant_harden_device_command_events ON device_command_events;
CREATE TRIGGER tenant_harden_device_command_events BEFORE INSERT OR UPDATE ON device_command_events
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_command_event();

DROP TRIGGER IF EXISTS tenant_harden_guardian_capture_events ON guardian_capture_events;
CREATE TRIGGER tenant_harden_guardian_capture_events BEFORE INSERT OR UPDATE ON guardian_capture_events
FOR EACH ROW EXECUTE FUNCTION tenant_harden_org_from_device();

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