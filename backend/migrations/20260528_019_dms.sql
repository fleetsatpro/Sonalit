-- Dead Man's Switch — add DMS columns to guardian_devices
-- Idempotent: all changes guarded with IF NOT EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guardian_devices' AND column_name = 'dms_enabled'
  ) THEN
    ALTER TABLE guardian_devices ADD COLUMN dms_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guardian_devices' AND column_name = 'dms_timeout_minutes'
  ) THEN
    ALTER TABLE guardian_devices
      ADD COLUMN dms_timeout_minutes INTEGER
        CHECK (dms_timeout_minutes IS NULL OR (dms_timeout_minutes >= 1 AND dms_timeout_minutes <= 1440));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guardian_devices' AND column_name = 'dms_suspended_until'
  ) THEN
    ALTER TABLE guardian_devices ADD COLUMN dms_suspended_until TIMESTAMPTZ;
  END IF;
END $$;

-- Index to efficiently find devices whose DMS has timed out
CREATE INDEX IF NOT EXISTS idx_guardian_devices_dms
  ON guardian_devices(last_checkin_at)
  WHERE dms_enabled = true AND deleted_at IS NULL;

-- Seed config row for the DMS background check interval if absent
INSERT INTO guardian_config (key, value_int, description)
VALUES ('dms_check_interval_seconds', 60, 'How often the server checks for DMS timeout violations')
ON CONFLICT (key) DO NOTHING;
