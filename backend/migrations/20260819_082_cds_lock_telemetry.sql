-- Live telemetry ingestion for Securisat / Viasat Connect solar e-locks.
--
-- The locks report into the Securysat Fleet platform (dev.viasatconnect.be).
-- The goal is to pull that telemetry straight into CDS so the control room,
-- Yard and Port screens track containers without anyone opening the Securisat
-- portal.
--
-- The lock schema already carries the live fields a telemetry sample updates —
-- battery_level, solar_charging, signal_strength, lat/lng, temperature,
-- tamper_detected/tamper_status, last_heartbeat (migration 073) — and
-- cds_lock_events already types heartbeat / gps_update / tamper / battery_low.
-- What was missing is the plumbing to receive telemetry from an external
-- provider and the couple of columns that plumbing needs.

-- ─── Link a lock to its device on the provider side ──────────────────────────
ALTER TABLE cds_electronic_locks
  -- The provider's own id for the device (asset id / unit id). The serial is
  -- what ops read off the physical lock; this is what the Securisat API keys
  -- on, and the two are not guaranteed identical, so telemetry is matched on
  -- this first and falls back to serial.
  ADD COLUMN IF NOT EXISTS external_device_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS speed_kmh          DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS heading            INTEGER,
  -- Distinct from last_heartbeat: a heartbeat is a keep-alive, this is the
  -- timestamp of the most recent telemetry sample of any kind that we ingested.
  ADD COLUMN IF NOT EXISTS last_telemetry_at  TIMESTAMPTZ;

-- Upserts key on (org_id, external_device_id): one provider device is one lock.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cds_locks_external_device
  ON cds_electronic_locks(org_id, external_device_id)
  WHERE external_device_id IS NOT NULL AND deleted_at IS NULL;

-- ─── Idempotent event ingestion ──────────────────────────────────────────────
-- A poller re-reads the same samples, and a webhook can be retried, so an
-- event carries the provider's own id for it. The partial unique index makes a
-- re-delivered sample a no-op instead of a duplicated row in the trail.
ALTER TABLE cds_lock_events
  ADD COLUMN IF NOT EXISTS external_event_id VARCHAR(96),
  ADD COLUMN IF NOT EXISTS recorded_at       TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cds_lock_events_external
  ON cds_lock_events(lock_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- The live map reads the most recent GPS points per lock; index for it.
CREATE INDEX IF NOT EXISTS idx_cds_lock_events_gps
  ON cds_lock_events(lock_id, created_at DESC)
  WHERE type IN ('gps_update','heartbeat');

-- ─── Per-org telemetry source config + health ────────────────────────────────
-- One row per org per provider. Secrets (API keys) live in env, never here —
-- this table holds the non-secret wiring (which provider, its base URL, the
-- account/fleet id we pull) and the health the admin screen shows so
-- "Securisat: Connected" stops being a hardcoded lie.
CREATE TABLE IF NOT EXISTS cds_telemetry_sources (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL,
  provider              VARCHAR(40) NOT NULL DEFAULT 'securisat',
  -- The provider account / fleet identifier this org's locks live under.
  external_account_id   VARCHAR(120),
  base_url              VARCHAR(255),
  enabled               BOOLEAN     NOT NULL DEFAULT TRUE,
  poll_interval_seconds INTEGER     NOT NULL DEFAULT 60
                        CHECK (poll_interval_seconds BETWEEN 15 AND 3600),
  -- Health, written by the poller each cycle so the UI can show a real status.
  last_polled_at        TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_error            TEXT,
  devices_seen          INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_cds_telemetry_sources_org ON cds_telemetry_sources(org_id);

ALTER TABLE cds_telemetry_sources ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'cds_telemetry_sources'
       AND policyname = 'org_isolation_cds_telemetry_sources'
  ) THEN
    CREATE POLICY org_isolation_cds_telemetry_sources ON cds_telemetry_sources
      USING (org_id = current_setting('app.current_org_id', true)::UUID);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON cds_telemetry_sources TO sonalit_app;
