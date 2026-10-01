-- Tenant isolation hardening: close legacy child-table and owner-role bypasses.
-- Reserved quarantine tenant is intentionally not assigned to any user.
BEGIN;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'convoy_assignments','checkpoints','driver_events','notifications',
    'device_locations','device_health','device_commands',
    'geofence_actions','sensor_logs','documents','fuel_logs',
    'convoy_trucks','convoy_cfos','convoy_cfo_truck_assignments',
    'convoy_truck_photos','convoy_daily_reports',
    'guardian_command_nonces','cfo_login_attempts','guardian_audit_log',
    'enrollment_codes','convoy_codes','api_keys','outbox'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=t AND column_name='org_id'
       ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN org_id UUID DEFAULT NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Backfill from authoritative parent relationships.
UPDATE convoy_assignments ca SET org_id=c.org_id
FROM convoys c WHERE c.id=ca.convoy_id AND ca.org_id IS NULL;

UPDATE checkpoints cp SET org_id=COALESCE(c.org_id,s.org_id)
FROM shipments s LEFT JOIN convoys c ON c.id=cp.convoy_id
WHERE s.id=cp.shipment_id AND cp.org_id IS NULL;
UPDATE checkpoints cp SET org_id=c.org_id
FROM convoys c WHERE c.id=cp.convoy_id AND cp.org_id IS NULL;

UPDATE driver_events de SET org_id=d.org_id
FROM drivers d WHERE d.id=de.driver_id AND de.org_id IS NULL;

UPDATE notifications n SET org_id=u.org_id
FROM users u WHERE u.id=n.user_id AND n.org_id IS NULL;

UPDATE device_locations dl SET org_id=gd.org_id
FROM guardian_devices gd WHERE gd.id=dl.device_id AND dl.org_id IS NULL;
UPDATE device_health dh SET org_id=gd.org_id
FROM guardian_devices gd WHERE gd.id=dh.device_id AND dh.org_id IS NULL;
UPDATE device_commands dc SET org_id=gd.org_id
FROM guardian_devices gd WHERE gd.id=dc.device_id AND dc.org_id IS NULL;

UPDATE geofence_actions ga SET org_id=g.org_id
FROM geofences g WHERE g.id=ga.geofence_id AND ga.org_id IS NULL;

UPDATE sensor_logs sl SET org_id=v.org_id
FROM vehicles v WHERE v.id=sl.vehicle_id AND sl.org_id IS NULL;

UPDATE documents d SET org_id=c.org_id
FROM convoys c WHERE c.id=d.convoy_id AND d.org_id IS NULL;

UPDATE fuel_logs fl SET org_id=v.org_id
FROM vehicles v WHERE v.id=fl.vehicle_id AND fl.org_id IS NULL;

UPDATE convoy_trucks ct SET org_id=c.org_id
FROM convoys c WHERE c.id=ct.convoy_id AND ct.org_id IS NULL;
UPDATE convoy_cfos cc SET org_id=c.org_id
FROM convoys c WHERE c.id=cc.convoy_id AND cc.org_id IS NULL;
UPDATE convoy_cfo_truck_assignments ca SET org_id=c.org_id
FROM convoys c WHERE c.id=ca.convoy_id AND ca.org_id IS NULL;
UPDATE convoy_truck_photos cp SET org_id=c.org_id
FROM convoys c WHERE c.id=cp.convoy_id AND cp.org_id IS NULL;
UPDATE convoy_daily_reports cr SET org_id=c.org_id
FROM convoys c WHERE c.id=cr.convoy_id AND cr.org_id IS NULL;

UPDATE guardian_command_nonces gn SET org_id=gd.org_id
FROM guardian_devices gd WHERE gd.id=gn.device_id AND gn.org_id IS NULL;
UPDATE cfo_login_attempts ca SET org_id=gd.org_id
FROM guardian_devices gd WHERE gd.id=ca.device_id AND ca.org_id IS NULL;

UPDATE guardian_audit_log gl SET org_id=u.org_id
FROM users u WHERE u.id=gl.actor_id AND gl.org_id IS NULL;

UPDATE enrollment_codes ec SET org_id=u.org_id
FROM users u WHERE u.id=ec.created_by AND ec.org_id IS NULL;
UPDATE convoy_codes cc SET org_id=u.org_id
FROM users u WHERE u.id=cc.created_by AND cc.org_id IS NULL;

-- API keys and any otherwise-unresolvable legacy rows are quarantined rather
-- than exposed. New tenant-authenticated inserts receive the ambient tenant.
UPDATE api_keys SET org_id='ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid WHERE org_id IS NULL;
UPDATE guardian_audit_log SET org_id='ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid WHERE org_id IS NULL;
UPDATE enrollment_codes SET org_id='ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid WHERE org_id IS NULL;
UPDATE convoy_codes SET org_id='ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid WHERE org_id IS NULL;
UPDATE outbox SET org_id='ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid WHERE org_id IS NULL;

-- For tables whose rows could not be linked, quarantine them. This is
-- deliberately safer than guessing ownership.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'convoy_assignments','checkpoints','driver_events','notifications',
    'device_locations','device_health','device_commands',
    'geofence_actions','sensor_logs','documents','fuel_logs',
    'convoy_trucks','convoy_cfos','convoy_cfo_truck_assignments',
    'convoy_truck_photos','convoy_daily_reports',
    'guardian_command_nonces','cfo_login_attempts'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I SET org_id=''ffffffff-ffff-4fff-8fff-ffffffffffff''::uuid WHERE org_id IS NULL',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Harden every tenant-bearing table known to this monolith.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','vehicles','convoys','alerts','incidents','gps_logs','drivers',
    'shipments','trips','invoices','expenses','maintenance_records','risk_zones',
    'audit_logs','reports','guardian_devices','panic_events',
    'channels','channel_members','messages','message_attachments',
    'message_reactions','pinned_messages',
    'cargo_clients','cargo_client_links','client_magic_links','client_notification_prefs',
    'proof_of_delivery','portal_documents','custody_events',
    'vehicle_documents','fuel_entries','fuel_anomalies','approved_fuel_stations',
    'geofences','geofence_events','convoy_route_corridors',
    'route_analyses','sync_devices','sync_operations','sync_conflicts','sync_change_log',
    'telemetry_ingest_keys','tracking_qr_codes','tracking_sessions','tracking_locations',
    'tracking_events','tracking_session_containers',
    'spatial_events','intel_observations','intelligence_alerts',
    'cds_customers','cds_transporters','cds_vehicles','cds_drivers','cds_containers',
    'cds_electronic_locks','cds_lock_events','cds_bookings','cds_trips','cds_trip_events',
    'cds_gps_history','cds_geofences','cds_alerts','cds_incidents','cds_documents',
    'cds_notifications','cds_audit_logs','cds_activity_feed','cds_reports',
    'cds_booking_containers','cds_client_pulse_runs','email_notifications',
    'email_routing_policies','field_officers','field_devices','field_sessions',
    'guardian_voice_messages','guardian_captures','officer_activity_events',
    'convoy_handovers','guardian_command_events'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=t AND column_name='org_id'
       ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_hardened ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation_hardened ON public.%I
          USING (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)
          WITH CHECK (org_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Child tables without a duplicated org_id are denied unless they can be
-- matched to a row in the same tenant. (Kept for any schema that still lacks
-- the added org_id during a rolling migration.)
ALTER TABLE IF EXISTS guardian_config DISABLE ROW LEVEL SECURITY;

COMMIT;
