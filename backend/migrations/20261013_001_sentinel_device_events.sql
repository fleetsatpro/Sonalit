-- Sentinel device events — the signed, append-only evidence store for hardware
-- units that report more than a position.
--
-- WHY A NEW TABLE
-- tracking_locations holds positions and the fabric reconciles them. A door
-- opening on a parked trailer, a cut seal, a tamper switch or an impact trace
-- is not a position, and its value is exactly that it came from one specific
-- unit and was not altered afterwards. So the original event is stored as the
-- device sent it — signature, signing string and all — and anything derived
-- from it (a custody ledger row, an alert) points back here by id. The ledger
-- hash chains are unchanged; this table is what lets anyone walk from a ledger
-- row to the signed original.
--
-- BANDS
-- band 0 = P0 (send at once, any uplink), 1 = P1, 2 = P2 telemetry. P2 is by
-- far the highest-volume class (vehicle and proximity summaries). It is kept
-- apart by `band` so a retention job can prune it without touching evidence.
-- Partitioning by month is the follow-up if volume demands it; it is left out
-- here because a unique key across partitions would have to include the
-- partition column and weaken the duplicate check.

CREATE TABLE IF NOT EXISTS device_events (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID         NOT NULL,
  device_id      UUID         NOT NULL REFERENCES guardian_devices(id),

  -- The journey that was live when the event arrived, if any. Deliberately
  -- nullable and without a foreign key: a tamper or door event on a parked
  -- vehicle must be stored whether or not a journey exists, and a session row
  -- being removed must never take evidence with it.
  session_id     UUID,

  -- `<serial>:<counter>`. No `|`: it is the delimiter of the signed string.
  event_id       TEXT         NOT NULL CHECK (event_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  counter        BIGINT       NOT NULL CHECK (counter >= 0),
  type           TEXT         NOT NULL CHECK (type IN (
                   'alert.panic',
                   'custody.door','custody.seal','custody.driver',
                   'sensor.reading','sensor.alarm',
                   'motion.impact','motion.harsh','motion.tilt',
                   'integrity.gnss','integrity.tamper','integrity.attest',
                   'power.state',
                   'vehicle.state','proximity.summary')),
  band           SMALLINT     NOT NULL CHECK (band IN (0, 1, 2)),

  occurred_at    TIMESTAMPTZ  NOT NULL,
  time_source    TEXT         NOT NULL CHECK (time_source IN ('gnss','network','rtc')),
  uplink         TEXT         NOT NULL CHECK (uplink IN ('direct','ble_relay','lora_hop','satellite')),
  buffered       BOOLEAN      NOT NULL DEFAULT FALSE,

  lat            NUMERIC(10,7) CHECK (lat BETWEEN -90 AND 90),
  lng            NUMERIC(10,7) CHECK (lng BETWEEN -180 AND 180),
  accuracy_m     REAL         CHECK (accuracy_m >= 0),

  data           JSONB        NOT NULL,

  -- Everything needed to verify the event again without trusting how the
  -- server happens to canonicalise it today: the exact string that was signed,
  -- the key it was signed with, and the signature.
  signing_string TEXT         NOT NULL,
  kid            TEXT         NOT NULL,
  sig            BYTEA        NOT NULL CHECK (octet_length(sig) = 64),

  -- Events from a key later found compromised are kept, never deleted; they
  -- are marked untrusted so reads can tell them apart.
  trust          TEXT         NOT NULL DEFAULT 'trusted'
                              CHECK (trust IN ('trusted','untrusted')),

  received_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- The duplicate check. A replay of the same event hits this and returns no
  -- row, which is the idempotency signal the ingest routes already rely on.
  UNIQUE (device_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_device_events_device_counter
  ON device_events(device_id, counter DESC);
-- Operators read evidence by type and time; telemetry (band 2) is excluded so
-- that index stays small.
CREATE INDEX IF NOT EXISTS idx_device_events_org_evidence
  ON device_events(org_id, type, occurred_at DESC) WHERE band <= 1;
CREATE INDEX IF NOT EXISTS idx_device_events_session
  ON device_events(session_id, occurred_at) WHERE session_id IS NOT NULL;
-- Retention scans for the high-volume class.
CREATE INDEX IF NOT EXISTS idx_device_events_telemetry_age
  ON device_events(received_at) WHERE band = 2;

-- Append-only. The only permitted change to a row is trusted -> untrusted.
CREATE OR REPLACE FUNCTION device_events_append_only() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'device_events is append-only: delete refused';
  END IF;
  IF NEW.trust = 'untrusted' AND OLD.trust = 'trusted'
     AND ROW(NEW.id, NEW.org_id, NEW.device_id, NEW.session_id, NEW.event_id, NEW.counter,
             NEW.type, NEW.band, NEW.occurred_at, NEW.time_source, NEW.uplink, NEW.buffered,
             NEW.lat, NEW.lng, NEW.accuracy_m, NEW.data, NEW.signing_string, NEW.kid,
             NEW.sig, NEW.received_at)
         IS NOT DISTINCT FROM
         ROW(OLD.id, OLD.org_id, OLD.device_id, OLD.session_id, OLD.event_id, OLD.counter,
             OLD.type, OLD.band, OLD.occurred_at, OLD.time_source, OLD.uplink, OLD.buffered,
             OLD.lat, OLD.lng, OLD.accuracy_m, OLD.data, OLD.signing_string, OLD.kid,
             OLD.sig, OLD.received_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'device_events is append-only: only trust may change, and only to untrusted';
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_device_events_append_only ON device_events;
CREATE TRIGGER trg_device_events_append_only
  BEFORE UPDATE OR DELETE ON device_events
  FOR EACH ROW EXECUTE FUNCTION device_events_append_only();

-- The policies read the tenant with NULLIF so a session with no organisation
-- set sees no rows. Casting an empty string straight to uuid would raise an
-- error instead; failing closed is right, but an error is a worse failure mode
-- than an empty result for a pooled connection that has just been reset.
ALTER TABLE device_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_events FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_events_org_isolation ON device_events;
CREATE POLICY device_events_org_isolation ON device_events
  USING      (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Quarantine. A rejected event is evidence too — an impossible jump on the
-- positions path is stored and flagged rather than dropped, and the same
-- applies here. A burst of bad signatures from one unit is itself a finding.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS device_event_quarantine (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID         NOT NULL,
  device_id    UUID         REFERENCES guardian_devices(id),
  event_id     TEXT,
  reason       TEXT         NOT NULL CHECK (reason IN (
                 'bad_signature','unknown_kid','revoked_kid','device_mismatch',
                 'counter_conflict','time_future','schema')),
  envelope     JSONB        NOT NULL,
  received_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Serves the "three bad signatures in ten minutes" alert rule.
CREATE INDEX IF NOT EXISTS idx_device_event_quarantine_recent
  ON device_event_quarantine(device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_event_quarantine_org
  ON device_event_quarantine(org_id, received_at DESC);

ALTER TABLE device_event_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_event_quarantine FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_event_quarantine_org_isolation ON device_event_quarantine;
CREATE POLICY device_event_quarantine_org_isolation ON device_event_quarantine
  USING      (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Device public keys. The private half is generated inside the unit's secure
-- element and never leaves it; only the public half is registered, once, at
-- enrolment. Several rows per device allow rotation without a gap.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS device_public_keys (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID         NOT NULL,
  device_id    UUID         NOT NULL REFERENCES guardian_devices(id),
  kid          TEXT         NOT NULL CHECK (char_length(kid) BETWEEN 1 AND 32),
  -- Uncompressed P-256 point: 0x04 followed by X and Y, 65 bytes.
  public_key   BYTEA        NOT NULL
               CHECK (octet_length(public_key) = 65 AND get_byte(public_key, 0) = 4),
  status       TEXT         NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','revoked')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  UNIQUE (device_id, kid),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_device_public_keys_active
  ON device_public_keys(device_id, kid) WHERE status = 'active';

ALTER TABLE device_public_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_public_keys FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_public_keys_org_isolation ON device_public_keys;
CREATE POLICY device_public_keys_org_isolation ON device_public_keys
  USING      (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Ingest credentials: allow the new source, and require it to be bound to one
-- device. A fleet-wide Sentinel key would let any unit's key speak for any
-- other; the signature check would catch it, but the credential should not
-- permit it in the first place.
-- ---------------------------------------------------------------------------

ALTER TABLE telemetry_ingest_keys ADD COLUMN IF NOT EXISTS device_id UUID;

ALTER TABLE telemetry_ingest_keys DROP CONSTRAINT IF EXISTS telemetry_ingest_keys_source_check;
ALTER TABLE telemetry_ingest_keys ADD CONSTRAINT telemetry_ingest_keys_source_check
  CHECK (source IN ('securisat_elock','device_telematics','sonalit_sentinel'));

ALTER TABLE telemetry_ingest_keys DROP CONSTRAINT IF EXISTS telemetry_ingest_keys_sentinel_device_bound;
ALTER TABLE telemetry_ingest_keys ADD CONSTRAINT telemetry_ingest_keys_sentinel_device_bound
  CHECK (source <> 'sonalit_sentinel' OR device_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Link the custody ledgers back to the signed original. The chain hash does
-- not include this column, so every existing row verifies exactly as before.
-- ---------------------------------------------------------------------------

ALTER TABLE custody_events     ADD COLUMN IF NOT EXISTS device_event_id UUID REFERENCES device_events(id);
ALTER TABLE cds_custody_events ADD COLUMN IF NOT EXISTS device_event_id UUID REFERENCES device_events(id);

CREATE INDEX IF NOT EXISTS idx_custody_events_device_event
  ON custody_events(device_event_id) WHERE device_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cds_custody_events_device_event
  ON cds_custody_events(device_event_id) WHERE device_event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- withOrg() runs queries as sonalit_app, which needs rights on the new tables.
-- Least privilege: evidence is never deleted by the application, and the only
-- UPDATE it may make is the trust flag (the append-only trigger enforces that).
-- ---------------------------------------------------------------------------

GRANT  SELECT, INSERT, UPDATE ON device_events           TO sonalit_app;
GRANT  SELECT, INSERT, DELETE ON device_event_quarantine TO sonalit_app;
GRANT  SELECT, INSERT, UPDATE ON device_public_keys      TO sonalit_app;
-- Default privileges from the app-role migration may already have granted more
-- to the role that created these tables. Take the extra back.
REVOKE DELETE ON device_events      FROM sonalit_app;
REVOKE DELETE ON device_public_keys FROM sonalit_app;
