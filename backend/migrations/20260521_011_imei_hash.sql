-- T5.5: GDPR — hash IMEI at ingestion, never store raw value in persistent storage
ALTER TABLE guardian_devices
  ADD COLUMN IF NOT EXISTS imei_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_devices_imei_hash
  ON guardian_devices(imei_hash)
  WHERE imei_hash IS NOT NULL AND deleted_at IS NULL;

-- Nullify raw imei column (existing rows retain hash after backfill)
-- Backfill command (run once, replace <PEPPER> with actual secret):
-- UPDATE guardian_devices SET imei_hash = encode(digest(imei || '<PEPPER>', 'sha256'), 'hex') WHERE imei IS NOT NULL;
-- After backfill: ALTER TABLE guardian_devices DROP COLUMN imei;
-- For now, keep both columns during transition.
