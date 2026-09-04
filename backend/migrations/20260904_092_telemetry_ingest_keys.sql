-- Telemetry ingest credentials — the door every non-driver source comes through.
--
-- WHY A NEW TABLE RATHER THAN api_keys
-- api_keys has no org_id. Telemetry ingestion is the one surface where tenancy
-- cannot be inferred from a logged-in user, because the caller is a machine:
-- a telematics box, a lock provider's webhook, a fleet platform. §35 forbids
-- trusting a client-supplied organizationId, so the ONLY safe place for the
-- tenant is the credential itself. A key must also be scoped to a single
-- source and revocable on its own, so a compromised telematics integration
-- cannot be used to forge e-lock evidence. api_keys expresses none of that,
-- and widening it would change an auth surface already in use elsewhere.
--
-- The shape deliberately mirrors tracking_qr_codes: SHA-256 hash only, raw
-- token returned exactly once at creation, revocable, org-scoped under RLS.
-- That pattern is already proven in this codebase and audited; inventing a
-- second credential idiom for the same job would be the riskier choice.
--
-- SECURISAT IS NOT A PRECONDITION HERE. This table serves any authorized
-- source. guardian_gps continues to authenticate with its session token and
-- needs no key. device_telematics can be issued one today. securisat_elock
-- uses the identical path the moment credentials exist — a row, not a code
-- change. Redundancy must not wait on the source that happens to be primary.

CREATE TABLE IF NOT EXISTS telemetry_ingest_keys (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL,

  -- Never the raw key. Issued once at creation and unrecoverable afterwards,
  -- exactly as with QR tokens: a credential that can be re-read from the
  -- database is a credential that leaks with the database.
  key_hash          CHAR(64)    NOT NULL UNIQUE,
  -- Non-secret leading fragment, so a human can identify which key to revoke
  -- without ever handling the secret.
  key_prefix        VARCHAR(12) NOT NULL,

  label             TEXT        NOT NULL,

  -- One source per key. A telematics provider's credential must not be able to
  -- write e-lock evidence: that would let a weaker integration manufacture the
  -- stronger source's testimony, which is precisely what the priority ordering
  -- assumes cannot happen.
  source            TEXT        NOT NULL
                                CHECK (source IN ('securisat_elock','device_telematics')),

  -- Optional narrowing. A per-vehicle key limits the blast radius of a leak to
  -- one truck rather than a whole fleet.
  vehicle_id        UUID,

  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','revoked','expired')),
  expires_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  revoked_reason    TEXT,

  -- Operational visibility without touching the secret.
  last_used_at      TIMESTAMPTZ,
  last_used_ip      TEXT,
  events_accepted   BIGINT      NOT NULL DEFAULT 0,
  events_rejected   BIGINT      NOT NULL DEFAULT 0,

  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telemetry_ingest_keys_org
  ON telemetry_ingest_keys(org_id, source) WHERE deleted_at IS NULL;
-- Lookup on the hot path is by hash alone; the partial index keeps revoked and
-- expired keys out of it so a withdrawn credential cannot be matched at all.
CREATE INDEX IF NOT EXISTS idx_telemetry_ingest_keys_active
  ON telemetry_ingest_keys(key_hash)
  WHERE status = 'active' AND deleted_at IS NULL;

ALTER TABLE telemetry_ingest_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_ingest_keys FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telemetry_ingest_keys_org_isolation ON telemetry_ingest_keys;
CREATE POLICY telemetry_ingest_keys_org_isolation ON telemetry_ingest_keys
  USING (org_id = (current_setting('app.current_org_id', true))::uuid);
