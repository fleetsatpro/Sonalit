-- SONALIT HYBRID TRACKING — permanent multi-source vehicle/container tracking.
--
-- Sonalit must always be able to answer "where is this container?", and it must
-- keep answering when any single tracking technology fails. So tracking is
-- modelled as an *engine fed by interchangeable sources* rather than as a
-- property of one device:
--
--        Guardian GPS (QR)    SecuriSat e-lock    future telematics
--                  \                |                  /
--                   \               |                 /
--                    ──────  tracking_locations  ──────
--                                   │
--                          canonical position on
--                           tracking_sessions
--                                   │
--                        CDS · Convoys · Command
--
-- Guardian GPS is NOT a stopgap until SecuriSat arrives. When e-locks land they
-- become a second row in `source` and a second opinion during reconciliation;
-- they never remove the phone-GPS channel. Losing either source degrades
-- confidence, not availability.
--
-- Two ideas are kept deliberately separate, because conflating them is the
-- classic bug in QR-activated tracking:
--
--   * A QR CODE authorises the *start* of a journey. It is consumed on first
--     successful activation and is worthless afterwards.
--   * A TRACKING SESSION is the live telemetry object. It outlives the QR and
--     is ended by an operational event (container delivered, convoy ended) —
--     never by the driver, and never by a wall-clock timer.
--
-- That is why `tracking_qr_codes.expires_at` is nullable: a QR is valid until
-- its journey says otherwise, not for an arbitrary 24 hours.

-- ─── QR codes ────────────────────────────────────────────────────────────────
-- The QR encodes an opaque token and nothing else — no container numbers, no
-- registrations, no database ids — so a photographed QR leaks no operational
-- data. Only the SHA-256 of the token is stored, exactly like field_devices in
-- migration 079: a stolen database row cannot be turned back into a scannable
-- code.
CREATE TABLE IF NOT EXISTS tracking_qr_codes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL,

  token_hash            CHAR(64)    NOT NULL UNIQUE,

  -- Which workflow minted it. Drives what the driver sees on the scan screen
  -- and which operational entity owns the lifecycle.
  purpose               TEXT        NOT NULL
                                    CHECK (purpose IN ('cds_container','convoy_vehicle')),

  -- generated → ready → scanned → activated → consumed
  -- with expired / revoked / cancelled / replaced as terminal side-exits.
  -- 'consumed' is the happy end state: the QR did its one job.
  status                TEXT        NOT NULL DEFAULT 'ready'
                                    CHECK (status IN ('generated','ready','scanned','activated',
                                                      'consumed','expired','revoked','cancelled','replaced')),

  -- The operational event that will end tracking. Chosen at generation time so
  -- a mixed convoy/container journey is never ambiguous about who owns the end.
  termination_policy    TEXT        NOT NULL DEFAULT 'container_delivered'
                                    CHECK (termination_policy IN ('container_delivered',
                                                                  'all_containers_delivered',
                                                                  'specific_container_delivered',
                                                                  'convoy_ended','manual')),
  termination_container_id UUID,

  -- Journey links. All nullable because a standalone container journey has no
  -- convoy, and a convoy vehicle QR may carry no CDS booking.
  trip_id               UUID,
  booking_id            UUID,
  convoy_id             UUID,
  vehicle_id            UUID,        -- core fleet vehicles(id)
  cds_vehicle_id        UUID,        -- cds_vehicles(id)
  driver_id             UUID,        -- cds_drivers(id)
  core_driver_id        UUID,        -- drivers(id)

  -- Non-sensitive snapshot shown on the driver's confirmation screen (vehicle
  -- registration, container count, destination label). Deliberately excludes
  -- anything the security boundary would not print on a gate pass.
  display               JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- NULL = journey-controlled, which is the norm. A value here is a belt-and-
  -- braces cap for QRs printed far ahead of departure.
  expires_at            TIMESTAMPTZ,

  issued_by             UUID,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scanned_at            TIMESTAMPTZ,
  activated_at          TIMESTAMPTZ,
  consumed_at           TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  revoked_by            UUID,
  revoke_reason         TEXT,
  replaced_by_qr_id     UUID,

  -- Throttling signal for enumeration attempts; the route rate-limits on top.
  scan_attempts         INT         NOT NULL DEFAULT 0,
  last_scan_attempt_at  TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tracking_qr_org        ON tracking_qr_codes(org_id, issued_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_qr_trip       ON tracking_qr_codes(trip_id)   WHERE trip_id   IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_qr_convoy     ON tracking_qr_codes(convoy_id) WHERE convoy_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_qr_open       ON tracking_qr_codes(org_id, status) WHERE status IN ('generated','ready','scanned') AND deleted_at IS NULL;

ALTER TABLE tracking_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_qr_codes FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_qr_codes_org_isolation ON tracking_qr_codes;
CREATE POLICY tracking_qr_codes_org_isolation ON tracking_qr_codes
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

-- ─── Tracking sessions ───────────────────────────────────────────────────────
-- The authoritative live-tracking object. One per activated QR (replay of the
-- same QR must not mint a second one — see the unique index below).
CREATE TABLE IF NOT EXISTS tracking_sessions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL,
  qr_code_id            UUID        REFERENCES tracking_qr_codes(id) ON DELETE SET NULL,

  -- The driver device's telemetry credential. Opaque, hashed, revocable — the
  -- QR token is spent at activation and is never reused for ingestion.
  session_token_hash    CHAR(64)    NOT NULL UNIQUE,

  -- 'awaiting_location' is the state that stops us lying: the session exists and
  -- permission was granted, but no valid fix has arrived, so the command centre
  -- shows STARTING rather than LIVE.
  status                TEXT        NOT NULL DEFAULT 'awaiting_location'
                                    CHECK (status IN ('awaiting_location','active','paused','signal_lost',
                                                      'completed','terminated','expired','cancelled')),

  termination_policy    TEXT        NOT NULL DEFAULT 'container_delivered'
                                    CHECK (termination_policy IN ('container_delivered',
                                                                  'all_containers_delivered',
                                                                  'specific_container_delivered',
                                                                  'convoy_ended','manual')),
  termination_container_id UUID,

  trip_id               UUID,
  booking_id            UUID,
  convoy_id             UUID,
  vehicle_id            UUID,
  cds_vehicle_id        UUID,
  driver_id             UUID,
  core_driver_id        UUID,

  -- Device binding (spec §10). Stops one QR being shared across phones: a
  -- telemetry post whose fingerprint disagrees is rejected and audited.
  device_fingerprint    CHAR(64),
  device_label          TEXT,
  app_version           TEXT,
  platform              TEXT,

  -- Location capability is a state, not a boolean, because "denied",
  -- "services off", "no background" and "no GPS hardware" need different
  -- operator responses (spec §16 of the permission spec).
  permission_status     TEXT        NOT NULL DEFAULT 'not_determined'
                                    CHECK (permission_status IN ('not_determined','granted','denied',
                                                                 'restricted','limited','unavailable')),
  background_status     TEXT        NOT NULL DEFAULT 'unknown'
                                    CHECK (background_status IN ('unknown','granted','denied','unsupported')),
  location_services_enabled BOOLEAN,
  gps_available         BOOLEAN,
  capability_verified_at TIMESTAMPTZ,
  capability_failure_reason TEXT,

  -- Canonical position, i.e. the winner of source reconciliation.
  current_lat           DOUBLE PRECISION,
  current_lng           DOUBLE PRECISION,
  current_accuracy_m    DOUBLE PRECISION,
  current_speed_kph     DOUBLE PRECISION,
  current_heading       DOUBLE PRECISION,
  current_altitude_m    DOUBLE PRECISION,
  current_source        TEXT        CHECK (current_source IN ('guardian_gps','securisat_elock','device_telematics')),
  current_confidence    TEXT        CHECK (current_confidence IN ('high','medium','low','unknown')),

  start_lat             DOUBLE PRECISION,
  start_lng             DOUBLE PRECISION,

  battery_level         INT         CHECK (battery_level BETWEEN 0 AND 100),
  network_status        TEXT,

  location_count        BIGINT      NOT NULL DEFAULT 0,
  buffered_count        BIGINT      NOT NULL DEFAULT 0,
  anomaly_count         BIGINT      NOT NULL DEFAULT 0,

  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_location_at     TIMESTAMPTZ,
  last_location_at      TIMESTAMPTZ,
  last_seen_at          TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,

  termination_reason    TEXT,
  terminated_by         UUID,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- Replay protection at the schema level: a QR can back at most one live
-- session. A revoked/completed session frees the slot only via an explicit
-- Guardian-authorised device replacement, which mints a new QR.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_sessions_live_qr
  ON tracking_sessions(qr_code_id)
  WHERE qr_code_id IS NOT NULL
    AND status IN ('awaiting_location','active','paused','signal_lost');

CREATE INDEX IF NOT EXISTS idx_tracking_sessions_org     ON tracking_sessions(org_id, started_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_live    ON tracking_sessions(org_id, last_location_at DESC)
  WHERE status IN ('awaiting_location','active','paused','signal_lost') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_trip    ON tracking_sessions(trip_id)   WHERE trip_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_convoy  ON tracking_sessions(convoy_id) WHERE convoy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracking_sessions_vehicle ON tracking_sessions(vehicle_id, cds_vehicle_id);

ALTER TABLE tracking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_sessions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_sessions_org_isolation ON tracking_sessions;
CREATE POLICY tracking_sessions_org_isolation ON tracking_sessions
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

-- ─── Containers carried by a session ─────────────────────────────────────────
-- A vehicle may carry several containers that are delivered at different times,
-- so completion is a set operation, not a single flag (spec §23).
CREATE TABLE IF NOT EXISTS tracking_session_containers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL,
  session_id    UUID        NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  container_id  UUID        NOT NULL,
  container_number TEXT,
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_session_container
  ON tracking_session_containers(session_id, container_id);
CREATE INDEX IF NOT EXISTS idx_tracking_session_containers_container
  ON tracking_session_containers(container_id) WHERE delivered_at IS NULL;

ALTER TABLE tracking_session_containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_session_containers FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_session_containers_org_isolation ON tracking_session_containers;
CREATE POLICY tracking_session_containers_org_isolation ON tracking_session_containers
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

-- ─── Telemetry ───────────────────────────────────────────────────────────────
-- Every accepted fix, from every source. `device_time` is the phone's clock and
-- `server_time` ours; keeping both is what lets buffered offline points be
-- replayed in their true order without being mistaken for live ones.
CREATE TABLE IF NOT EXISTS tracking_locations (
  id            BIGSERIAL   PRIMARY KEY,
  org_id        UUID        NOT NULL,
  session_id    UUID        NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,

  source        TEXT        NOT NULL DEFAULT 'guardian_gps'
                            CHECK (source IN ('guardian_gps','securisat_elock','device_telematics')),

  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  accuracy_m    DOUBLE PRECISION,
  altitude_m    DOUBLE PRECISION,
  speed_kph     DOUBLE PRECISION,
  heading       DOUBLE PRECISION,

  device_time   TIMESTAMPTZ NOT NULL,
  server_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  battery_level INT,
  network_status TEXT,

  -- True when the point sat in the phone's offline queue before reaching us.
  buffered      BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Anomalous telemetry is kept and flagged, never silently dropped (spec §36):
  -- an impossible jump is itself operational evidence.
  quality       TEXT        NOT NULL DEFAULT 'good'
                            CHECK (quality IN ('good','degraded','rejected')),
  anomaly_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_locations_session ON tracking_locations(session_id, device_time DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_locations_org     ON tracking_locations(org_id, server_time DESC);
-- Idempotent ingestion: a retried offline batch must not double-insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_locations_point
  ON tracking_locations(session_id, source, device_time);

ALTER TABLE tracking_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_locations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_locations_org_isolation ON tracking_locations;
CREATE POLICY tracking_locations_org_isolation ON tracking_locations
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

-- ─── Domain events ───────────────────────────────────────────────────────────
-- The journey timeline the container page and the convoy report both read from,
-- and the audit trail for every manual override.
CREATE TABLE IF NOT EXISTS tracking_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL,
  session_id    UUID        REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  qr_code_id    UUID        REFERENCES tracking_qr_codes(id) ON DELETE SET NULL,

  event_type    TEXT        NOT NULL,

  -- Who caused it: an operator, the driver's device, or the engine itself.
  actor_type    TEXT        NOT NULL DEFAULT 'system'
                            CHECK (actor_type IN ('system','operator','driver','field_agent','guardian')),
  actor_id      UUID,
  actor_name    TEXT,

  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_session ON tracking_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_org     ON tracking_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_events_type    ON tracking_events(org_id, event_type, created_at DESC);

ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_events FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_events_org_isolation ON tracking_events;
CREATE POLICY tracking_events_org_isolation ON tracking_events
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);
