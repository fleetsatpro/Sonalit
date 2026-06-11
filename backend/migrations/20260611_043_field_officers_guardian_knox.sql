-- Migration: 20260611_043_field_officers_guardian_knox
-- Adds field officer columns, Knox remote sessions, device telemetry,
-- officer activity events, device commands, and alert rules.

-- ============================================================
-- 1. ALTER field_officers — add missing columns
-- ============================================================

ALTER TABLE field_officers
  ADD COLUMN IF NOT EXISTS badge          TEXT,
  ADD COLUMN IF NOT EXISTS zone           TEXT,
  ADD COLUMN IF NOT EXISTS shift_start    TIME,
  ADD COLUMN IF NOT EXISTS shift_end      TIME,
  ADD COLUMN IF NOT EXISTS current_convoy_id UUID REFERENCES convoys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_id      UUID,
  ADD COLUMN IF NOT EXISTS missions_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkin_rate   NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sos_events_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seals_verified INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;

-- Update status check constraint to include new values.
-- Drop the existing constraint (name may vary; try both the default and a known name).
DO $$
BEGIN
  ALTER TABLE field_officers DROP CONSTRAINT IF EXISTS field_officers_status_check;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'field_officers'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE field_officers DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE field_officers
  ADD CONSTRAINT field_officers_status_check
  CHECK (status IN ('available', 'busy', 'offline', 'on_mission', 'sos'));

-- ============================================================
-- 2. RLS on field_officers
-- ============================================================

ALTER TABLE field_officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_officers FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY field_officers_org ON field_officers
    USING (org_id = current_setting('app.current_org_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_fo_org_status ON field_officers(org_id, status);
CREATE INDEX IF NOT EXISTS idx_fo_org_device  ON field_officers(org_id, device_id);

-- ============================================================
-- 3. CREATE TABLE officer_activity_events
-- ============================================================

CREATE TABLE IF NOT EXISTS officer_activity_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  officer_id  UUID NOT NULL REFERENCES field_officers(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL CHECK (event_type IN (
    'sos_triggered', 'sos_resolved', 'checkin', 'photo_submitted',
    'seal_verified', 'geofence_breach', 'report_generated',
    'mission_started', 'mission_completed', 'device_offline',
    'device_online', 'command_issued', 'command_acked'
  )),
  convoy_id   UUID REFERENCES convoys(id) ON DELETE SET NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE officer_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer_activity_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY oae_org ON officer_activity_events
    USING (org_id = current_setting('app.current_org_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_oae_officer_time ON officer_activity_events(officer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_oae_org_type     ON officer_activity_events(org_id, event_type, occurred_at DESC);

-- ============================================================
-- 4. CREATE TABLE knox_remote_sessions
--    (references guardian_devices which already exists;
--     guardian_devices will later reference this table — see step 5)
-- ============================================================

CREATE TABLE IF NOT EXISTS knox_remote_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL,
  device_id       UUID NOT NULL REFERENCES guardian_devices(id) ON DELETE CASCADE,
  officer_id      UUID REFERENCES field_officers(id) ON DELETE SET NULL,
  operator_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'initializing'
                  CHECK (status IN ('initializing', 'live', 'ended', 'error')),
  triggered_by    TEXT NOT NULL
                  CHECK (triggered_by IN ('sos', 'manual', 'scheduled')),
  webrtc_offer    JSONB,
  webrtc_answer   JSONB,
  ice_candidates  JSONB NOT NULL DEFAULT '[]',
  recording_key   TEXT,
  screenshot_keys JSONB NOT NULL DEFAULT '[]',
  duration_secs   INTEGER,
  event_log       JSONB NOT NULL DEFAULT '[]',
  latency_ms      INTEGER,
  fps             INTEGER,
  bitrate_kbps    INTEGER,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE knox_remote_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knox_remote_sessions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY krs_org ON knox_remote_sessions
    USING (org_id = current_setting('app.current_org_id', true)::uuid);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_krs_device     ON knox_remote_sessions(device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_krs_org_status ON knox_remote_sessions(org_id, status);

-- ============================================================
-- 5. ALTER guardian_devices — add telemetry + Knox columns
--    active_session_id FK to knox_remote_sessions (now exists)
-- ============================================================

ALTER TABLE guardian_devices
  ADD COLUMN IF NOT EXISTS battery_pct        INTEGER,
  ADD COLUMN IF NOT EXISTS signal_pct         INTEGER,
  ADD COLUMN IF NOT EXISTS gps_locked         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gps_lat            NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS gps_lng            NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS gps_accuracy_m     NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS gps_satellites     INTEGER,
  ADD COLUMN IF NOT EXISTS cpu_pct            INTEGER,
  ADD COLUMN IF NOT EXISTS ram_pct            INTEGER,
  ADD COLUMN IF NOT EXISTS app_version        TEXT,
  ADD COLUMN IF NOT EXISTS android_version    TEXT,
  ADD COLUMN IF NOT EXISTS knox_version       TEXT,
  ADD COLUMN IF NOT EXISTS knox_do_enrolled   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS dms_configured     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS telemetry_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS active_session_id  UUID REFERENCES knox_remote_sessions(id) ON DELETE SET NULL;

-- ============================================================
-- 6. Add FK from field_officers.device_id → guardian_devices
--    (column was added in step 1 without FK; add constraint now
--     that we know guardian_devices exists and is fully altered)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'field_officers'::regclass
      AND conname   = 'field_officers_device_id_fkey'
  ) THEN
    ALTER TABLE field_officers
      ADD CONSTRAINT field_officers_device_id_fkey
      FOREIGN KEY (device_id) REFERENCES guardian_devices(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 7. ALTER device_commands — add columns missing from base schema
--    (table already exists from 20260521_000_base_schema.sql)
-- ============================================================

ALTER TABLE device_commands
  ADD COLUMN IF NOT EXISTS org_id     UUID,
  ADD COLUMN IF NOT EXISTS command    TEXT,
  ADD COLUMN IF NOT EXISTS ttl_hours  INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS payload    JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS acked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Extend status check to cover full lifecycle (drop old constraint first if present)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'device_commands'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE device_commands DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE device_commands
  ADD CONSTRAINT device_commands_status_check
  CHECK (status IN ('pending', 'sent', 'executed', 'expired', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_dc_device_status ON device_commands(device_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_org            ON device_commands(org_id, created_at DESC);

-- ============================================================
-- 8. CREATE TABLE alert_rules (idempotent)
-- ============================================================

CREATE TABLE IF NOT EXISTS alert_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL,
  name       TEXT NOT NULL,
  trigger    TEXT NOT NULL CHECK (trigger IN (
    'battery_low', 'signal_lost', 'geofence_breach', 'sos', 'app_outdated'
  )),
  threshold  INTEGER,
  action     TEXT NOT NULL CHECK (action IN (
    'notify_admins', 'trigger_siren', 'lock_screen', 'auto_lock'
  )),
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ar_org ON alert_rules(org_id);
