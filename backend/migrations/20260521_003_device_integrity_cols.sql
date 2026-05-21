-- T1.4 — Per-device Play Integrity verdict timestamps
BEGIN;

ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS last_integrity_verdict_at  TIMESTAMPTZ;
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS last_integrity_verdict      TEXT;

CREATE INDEX IF NOT EXISTS idx_guardian_devices_integrity
  ON guardian_devices(last_integrity_verdict_at)
  WHERE deleted_at IS NULL;

COMMIT;
