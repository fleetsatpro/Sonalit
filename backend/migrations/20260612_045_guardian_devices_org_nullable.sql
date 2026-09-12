-- Make guardian_devices.org_id nullable.
-- Devices that enroll via PEGAGENT before a matching field officer exists
-- should not be rejected. An admin can assign the org later via the dashboard.
ALTER TABLE guardian_devices ALTER COLUMN org_id DROP NOT NULL;

-- Ensure android_id column exists (added by ensureTables() but not in base schema).
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS android_id TEXT;
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS fcm_token   TEXT;
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS last_checkin_at TIMESTAMPTZ;
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS convoy_code TEXT;
ALTER TABLE guardian_devices ADD COLUMN IF NOT EXISTS imei_hash   TEXT;

-- Unique index for android_id dedup (safe to re-run).
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardian_devices_android_id
  ON guardian_devices(android_id)
  WHERE android_id IS NOT NULL AND android_id <> 'unknown' AND deleted_at IS NULL;
