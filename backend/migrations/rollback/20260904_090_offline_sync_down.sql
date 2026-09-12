-- DOWN for 20260904_090_offline_sync.sql
--
-- Drops only what the UP created. The `revision` columns are dropped last
-- because the triggers reference them; nothing else in the schema reads them,
-- so removing them is safe and loses no operational data.
--
-- NOTE: this discards sync_operations and sync_conflicts, which are the audit
-- record of field work pushed from devices. Export them before running this in
-- an environment where that history matters.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'cds_bookings','cds_containers','cds_trips','convoys',
    'vehicles','cds_incidents','cds_geofences'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'ztrg_sync_log_' || t, t);
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_sync_revision_' || t, t);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS sync_log_change();
DROP FUNCTION IF EXISTS sync_bump_revision();

DROP TABLE IF EXISTS sync_change_log;
DROP SEQUENCE IF EXISTS sync_change_seq;
DROP TABLE IF EXISTS sync_conflicts;
DROP TABLE IF EXISTS sync_operations;
DROP TABLE IF EXISTS sync_devices;

ALTER TABLE cds_bookings   DROP COLUMN IF EXISTS revision;
ALTER TABLE cds_containers DROP COLUMN IF EXISTS revision;
ALTER TABLE cds_trips      DROP COLUMN IF EXISTS revision;
ALTER TABLE convoys        DROP COLUMN IF EXISTS revision;
