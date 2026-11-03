-- Telemetry evidence fabric — per-source health, conflicts, and auditable
-- reconciliation decisions.
--
-- WHY THIS EXISTS
-- Migration 088 gave us multi-source telemetry and a canonical position, but it
-- reasons about health at the SESSION level and keeps no record of how a
-- canonical position was chosen. That is enough while exactly one source is
-- live; it stops being enough the moment SecuriSat or vehicle telematics start
-- reporting alongside the driver's phone, because then three questions have no
-- home in the schema:
--
--   Which SOURCE is unhealthy?      — 088 can only say the session is stale.
--   Did the sources disagree?       — computeConfidence() notices and discards.
--   Why is the canonical position   — reconcile() picks a winner and keeps no
--     what it is?                     trace of what it rejected or why.
--
-- The tables below answer those three, and nothing else. They are additive:
-- no column is dropped, no type changed, no row rewritten. Existing tracking
-- keeps working untouched if nothing ever writes to them.
--
-- The governing rule is that raw observation and derived conclusion are
-- different layers. tracking_locations stays immutable evidence; every derived
-- claim lives here, carries the algorithm version that produced it, and points
-- back at the evidence both for and against. A reconciliation change later must
-- never make an earlier decision unexplainable.

-- ─── Per-source health ───────────────────────────────────────────────────────
-- One row per (session, source). Health is still DERIVED on read from freshness
-- — a cached is_live that survives telemetry failure is the exact lie this
-- system exists to prevent — but the inputs to that derivation, and the slower
-- signals that cannot be recomputed from a single fix (success rate, sequence
-- gaps, duplicates), need somewhere durable to live.
CREATE TABLE IF NOT EXISTS telemetry_sources (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL,
  session_id            UUID        NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,

  source                TEXT        NOT NULL
                                    CHECK (source IN ('guardian_gps','securisat_elock','device_telematics')),
  -- Which physical thing is reporting. Two phones on one journey are two rows.
  external_source_id    TEXT,

  -- 'unavailable' means we have no adapter or no credential — a different fact
  -- from 'offline', which means we had one and it went quiet. Collapsing the
  -- two would make an unintegrated source look like a broken one.
  state                 TEXT        NOT NULL DEFAULT 'initializing'
                                    CHECK (state IN ('initializing','healthy','degraded','stale',
                                                     'offline','recovering','unavailable',
                                                     'revoked','conflicted')),
  state_reason          TEXT,

  first_event_at        TIMESTAMPTZ,
  last_event_at         TIMESTAMPTZ,
  last_accepted_at      TIMESTAMPTZ,

  -- Transport quality, which freshness alone cannot express: a source landing
  -- every fix 90s late is not the same as one dropping half of them.
  events_received       BIGINT      NOT NULL DEFAULT 0,
  events_accepted       BIGINT      NOT NULL DEFAULT 0,
  events_rejected       BIGINT      NOT NULL DEFAULT 0,
  events_duplicate      BIGINT      NOT NULL DEFAULT 0,
  latency_ms_p50        INT,
  latency_ms_max        INT,

  -- Sequence continuity. A gap means points were lost in transit even when the
  -- ones that arrived look perfectly healthy.
  highest_sequence      BIGINT,
  sequence_gaps         INT         NOT NULL DEFAULT 0,

  -- Estimated device clock offset. Kept per source because two devices on one
  -- journey drift independently, and ordering by a wrong clock silently
  -- rewrites history.
  clock_offset_ms       BIGINT,
  clock_samples         INT         NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT uq_telemetry_source UNIQUE (session_id, source, external_source_id)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_sources_org
  ON telemetry_sources(org_id, last_event_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_sources_session
  ON telemetry_sources(session_id) WHERE deleted_at IS NULL;
-- The §31 alert that matters is "every source on this journey is gone", not
-- "a source went quiet"; this index is what makes that question cheap.
CREATE INDEX IF NOT EXISTS idx_telemetry_sources_unhealthy
  ON telemetry_sources(org_id, state)
  WHERE state IN ('stale','offline','revoked','conflicted') AND deleted_at IS NULL;

ALTER TABLE telemetry_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_sources FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telemetry_sources_org_isolation ON telemetry_sources;
CREATE POLICY telemetry_sources_org_isolation ON telemetry_sources
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

-- ─── Conflicts as first-class evidence ───────────────────────────────────────
-- When sources disagree, the disagreement IS the finding. Today
-- computeConfidence() sees a >2km discrepancy, returns 'low', and the reason
-- evaporates — operations gets a dimmer dot and no way to ask why. A conflict
-- must outlive the confidence score that noticed it.
--
-- Deliberately neutral vocabulary. 'spoofing_suspected' is a hypothesis about
-- data, never an accusation about a driver, and it stays open until evidence
-- resolves it rather than being auto-closed to keep a dashboard tidy.
CREATE TABLE IF NOT EXISTS telemetry_conflicts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL,
  session_id            UUID        NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,

  kind                  TEXT        NOT NULL
                                    CHECK (kind IN ('anomalous_telemetry','spoofing_suspected',
                                                    'data_conflict','sequence_gap',
                                                    'clock_anomaly','source_disagreement')),
  severity              TEXT        NOT NULL DEFAULT 'warning'
                                    CHECK (severity IN ('info','warning','critical')),

  status                TEXT        NOT NULL DEFAULT 'open'
                                    CHECK (status IN ('open','resolved','superseded','accepted')),

  detail                TEXT,
  -- The measurement that triggered it: km apart, seconds of drift, implied kph.
  metric_name           TEXT,
  metric_value          NUMERIC,
  threshold_value       NUMERIC,

  -- Evidence by reference, never by copy. Copying a fix into the conflict would
  -- create a second version of an observation that is supposed to be immutable.
  -- BIGINT because tracking_locations is BIGSERIAL: it is a high-volume
  -- append-only log, and a narrow key there is the right call.
  evidence_location_ids BIGINT[]    NOT NULL DEFAULT '{}',
  sources_involved      TEXT[]      NOT NULL DEFAULT '{}',

  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  resolution            TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telemetry_conflicts_org
  ON telemetry_conflicts(org_id, detected_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telemetry_conflicts_open
  ON telemetry_conflicts(org_id, session_id)
  WHERE status = 'open' AND deleted_at IS NULL;

ALTER TABLE telemetry_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_conflicts FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telemetry_conflicts_org_isolation ON telemetry_conflicts;
CREATE POLICY telemetry_conflicts_org_isolation ON telemetry_conflicts
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

-- ─── Auditable reconciliation decisions ──────────────────────────────────────
-- "Why did Sonalit conclude the journey went this way?" has to be answerable
-- months later, by someone who was not there, against an algorithm that has
-- since changed. That requires the decision, its confidence, the version of the
-- code that produced it, and BOTH sides of the evidence — including what was
-- rejected. A decision that only records its winner cannot be audited, only
-- believed.
--
-- 'unknown' is a first-class outcome here (§25). A system that must answer
-- true or false when the evidence supports neither will invent certainty, and
-- invented certainty in a cargo-security record is worse than an admitted gap.
CREATE TABLE IF NOT EXISTS reconciliation_decisions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL,
  session_id            UUID        NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,

  -- What was being decided: canonical_position, departure, arrival,
  -- lock_state, deviation, journey_end.
  subject               TEXT        NOT NULL,
  decision              TEXT        NOT NULL,

  certainty             TEXT        NOT NULL DEFAULT 'unknown'
                                    CHECK (certainty IN ('confirmed','probable','uncertain',
                                                         'conflicted','unknown')),
  confidence            TEXT        CHECK (confidence IN ('high','medium','low','unknown')),

  chosen_source         TEXT,
  -- tracking_locations ids: BIGINT, see telemetry_conflicts above.
  supporting_evidence   BIGINT[]    NOT NULL DEFAULT '{}',
  contradicting_evidence BIGINT[]   NOT NULL DEFAULT '{}',
  conflict_id           UUID        REFERENCES telemetry_conflicts(id) ON DELETE SET NULL,

  -- Bump when the algorithm changes. Old rows keep the version that made them,
  -- so a later rule change re-explains the future without rewriting the past.
  algorithm_version     TEXT        NOT NULL,
  inputs                JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- Late evidence (§17) can revise a conclusion. The old row is superseded,
  -- never updated in place, so the revision itself stays auditable.
  superseded_by         UUID        REFERENCES reconciliation_decisions(id) ON DELETE SET NULL,

  occurred_at           TIMESTAMPTZ,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_org
  ON reconciliation_decisions(org_id, generated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reconciliation_session
  ON reconciliation_decisions(session_id, subject, generated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reconciliation_current
  ON reconciliation_decisions(session_id, subject)
  WHERE superseded_by IS NULL AND deleted_at IS NULL;

ALTER TABLE reconciliation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_decisions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reconciliation_decisions_org_isolation ON reconciliation_decisions;
CREATE POLICY reconciliation_decisions_org_isolation ON reconciliation_decisions
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);

-- ─── Evidence identity on the observation itself ─────────────────────────────
-- All nullable, so every existing row stays valid and no backfill invents data
-- we never observed.
--
--   event_id        client-minted, the idempotency key that lets a store-and-
--                   forward client retry without the server having to guess
--                   from (session, source, device_time) whether a point is the
--                   same one arriving twice.
--   sequence_number per-source monotonic counter; a gap proves loss that
--                   arrival-order alone cannot reveal.
--   clock_offset_ms the drift estimate applied when this point landed, kept
--                   with the point so a later correction stays explainable.
ALTER TABLE tracking_locations
  ADD COLUMN IF NOT EXISTS event_id        UUID,
  ADD COLUMN IF NOT EXISTS sequence_number BIGINT,
  ADD COLUMN IF NOT EXISTS clock_offset_ms BIGINT;

-- Idempotency by client-supplied identity, alongside the existing
-- (session, source, device_time) guard rather than replacing it: a client that
-- sends no event_id is still protected, and one that does is protected even
-- when two genuine fixes share a timestamp.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracking_locations_event
  ON tracking_locations(session_id, event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tracking_locations_sequence
  ON tracking_locations(session_id, source, sequence_number)
  WHERE sequence_number IS NOT NULL;
