-- Reverses 20261013_001_sentinel_device_events.sql.
-- Order matters: ledger columns first (they reference device_events), then the
-- ingest-key constraints, then the new tables.
--
-- Fails, and rolls back as a whole, if any Sentinel ingest key still exists,
-- because the narrowed source check would reject it. Delete those keys first.

BEGIN;

DROP INDEX IF EXISTS idx_cds_custody_events_device_event;
DROP INDEX IF EXISTS idx_custody_events_device_event;
ALTER TABLE cds_custody_events DROP COLUMN IF EXISTS device_event_id;
ALTER TABLE custody_events     DROP COLUMN IF EXISTS device_event_id;

ALTER TABLE telemetry_ingest_keys DROP CONSTRAINT IF EXISTS telemetry_ingest_keys_sentinel_device_bound;
ALTER TABLE telemetry_ingest_keys DROP CONSTRAINT IF EXISTS telemetry_ingest_keys_source_check;
ALTER TABLE telemetry_ingest_keys ADD CONSTRAINT telemetry_ingest_keys_source_check
  CHECK (source IN ('securisat_elock','device_telematics'));
ALTER TABLE telemetry_ingest_keys DROP COLUMN IF EXISTS device_id;

DROP TABLE IF EXISTS device_public_keys;
DROP TABLE IF EXISTS device_event_quarantine;
DROP TRIGGER IF EXISTS trg_device_events_append_only ON device_events;
DROP TABLE IF EXISTS device_events;
DROP FUNCTION IF EXISTS device_events_append_only();

COMMIT;
