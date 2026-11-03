-- Tamper-evident custody ledger for containers moving through the CDS flow.
--
-- The platform's whole pitch is "every custody handoff cryptographically
-- sealed & chained", and convoys have exactly that in custody_events. Containers
-- did not: a clamp is the moment custody of a sealed box passes to a
-- transporter — arguably the single most important link — and it left no
-- verifiable record beyond a mutable row and an audit log.
--
-- Why not reuse custody_events: it is convoy-scoped (convoy_id NOT NULL
-- REFERENCES convoys) and its chain is keyed per convoy. A container's custody
-- runs along a booking, not a convoy, so it needs its own chain. Keeping it in
-- a cds_-prefixed table also matches the standing rule that CDS is a separate
-- domain from core fleet.
--
-- The chain: each row hashes its own contents plus the previous row's hash, so
-- altering or deleting any historical event breaks every hash after it. seq is
-- UNIQUE per container, which is also the concurrency backstop — two writers
-- racing to append the same seq means one fails rather than silently forking
-- the chain.

CREATE TABLE IF NOT EXISTS cds_custody_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID        NOT NULL,
  booking_container_id UUID        NOT NULL REFERENCES cds_booking_containers(id) ON DELETE CASCADE,
  trip_id              UUID        REFERENCES cds_trips(id),
  seq                  INTEGER     NOT NULL,
  kind                 TEXT        NOT NULL
    CHECK (kind IN ('clamped','dispatched','checkpoint','seal_check','arrived','unclamped','delivered','exception')),

  -- Who and where. actor_name is denormalised on purpose: a custody record has
  -- to still read correctly years later even if the user row is renamed or
  -- deleted, and re-deriving it from user_id would let a rename rewrite history.
  actor_user_id        UUID,
  actor_name           TEXT        CHECK (char_length(actor_name) <= 128),
  lat                  NUMERIC(10,7),
  lng                  NUMERIC(10,7),

  -- What was observed at this point in the chain.
  seal_number          VARCHAR(50),
  seal_intact          BOOLEAN,
  lock_serial          VARCHAR(30),
  notes                TEXT        CHECK (char_length(notes) <= 512),

  hash                 CHAR(64)    NOT NULL,
  prev_hash            CHAR(64),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (booking_container_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_cds_custody_container
  ON cds_custody_events(booking_container_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_cds_custody_org ON cds_custody_events(org_id);
-- Supervisors chase tamper findings across all containers, so make the
-- broken-seal case cheap to scan for.
CREATE INDEX IF NOT EXISTS idx_cds_custody_seal_broken
  ON cds_custody_events(org_id, created_at DESC) WHERE seal_intact IS FALSE;

ALTER TABLE cds_custody_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'cds_custody_events'
       AND policyname = 'org_isolation_cds_custody_events'
  ) THEN
    CREATE POLICY org_isolation_cds_custody_events ON cds_custody_events
      USING (org_id = current_setting('app.current_org_id', true)::UUID);
  END IF;
END $$;

-- withOrg() runs queries as sonalit_app, which needs rights on the new table.
-- 017 set ALTER DEFAULT PRIVILEGES, but that only covers objects created by the
-- role that ran it — granting explicitly avoids depending on which role applies
-- this migration in a given environment.
GRANT SELECT, INSERT, UPDATE, DELETE ON cds_custody_events TO sonalit_app;

-- No UPDATE/DELETE is ever issued against this table by the application: the
-- ledger is append-only by construction, and the hash chain is what makes an
-- out-of-band edit detectable rather than prevented.
