-- Offline-first / low-bandwidth field resilience — server-side foundation.
--
-- Strictly additive. Nothing here changes an existing table's semantics; the
-- only writes to existing tables are two new columns (`revision`) plus triggers
-- that maintain them, so every current query keeps working untouched.
--
-- Three concerns, three tables:
--
--   sync_devices     — which physical device a sync session belongs to, and how
--                      far it has replicated. The checkpoint lives server-side
--                      as well as on the device so a wiped device can be told
--                      "you are behind" rather than silently re-pulling nothing.
--
--   sync_operations  — the durable ledger that makes PUSH idempotent. The
--                      existing `idempotency_keys` middleware caches a response
--                      *after* the handler ran, which leaves a window where two
--                      concurrent retries of the same operation both execute the
--                      business action. Field devices retry precisely when they
--                      are unsure whether the first attempt landed, so that
--                      window is exactly the one that matters here: this table
--                      is claimed *before* the business mutation, inside the
--                      same transaction, so a duplicate loses the race and reads
--                      the winner's result instead of re-applying it.
--
--   sync_change_log  — the pull side. Timestamps alone cannot drive a correct
--                      incremental pull (clock skew, ties, out-of-order commits),
--                      so every replicated change gets a gap-free-enough
--                      monotonic `seq` from a dedicated sequence and the client
--                      checkpoint is that single integer.
--
-- sync_conflicts records a local event the server refused to apply because the
-- entity moved on underneath it. It exists so a conflict is never resolved by
-- silently discarding field work — the operator sees the losing event with the
-- full context needed to redo or dismiss it deliberately.

-- ─────────────────────────────────────────────────────────────────────────────
-- Device registry
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_devices (
  device_id        TEXT         NOT NULL,
  org_id           UUID         NOT NULL,
  user_id          UUID         REFERENCES users(id),
  platform         TEXT,
  app_version      TEXT,
  -- The device's local schema version. A device that is too far behind is told
  -- to update rather than allowed to push payloads the server can't interpret.
  schema_version   INTEGER      NOT NULL DEFAULT 1,
  -- Highest sync_change_log.seq this device has acknowledged receiving.
  pull_checkpoint  BIGINT       NOT NULL DEFAULT 0,
  last_pull_at     TIMESTAMPTZ,
  last_push_at     TIMESTAMPTZ,
  first_seen_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at       TIMESTAMPTZ,
  PRIMARY KEY (device_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_devices_org  ON sync_devices (org_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_devices_user ON sync_devices (user_id);

ALTER TABLE sync_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_devices_org_isolation ON sync_devices;
CREATE POLICY sync_devices_org_isolation ON sync_devices
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ─────────────────────────────────────────────────────────────────────────────
-- Operation ledger (durable idempotency + replay protection + audit)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_operations (
  operation_id      UUID         NOT NULL,
  org_id            UUID         NOT NULL,
  device_id         TEXT         NOT NULL,
  -- The user the server authenticated for this push. Never taken from the
  -- payload: a client-supplied user_id is a claim, not an identity.
  user_id           UUID         REFERENCES users(id),
  operation_type    TEXT         NOT NULL,
  entity_type       TEXT         NOT NULL,
  entity_id         TEXT,
  payload           JSONB        NOT NULL,
  -- claimed → the row exists but the handler has not committed yet. Because the
  -- claim and the business mutation share one transaction, a visible 'claimed'
  -- row can only mean the process died mid-flight; the recovery path treats it
  -- as retryable.
  status            TEXT         NOT NULL DEFAULT 'claimed'
                    CHECK (status IN ('claimed','accepted','rejected','conflict','failed')),
  result            JSONB,
  error_code        TEXT,
  error_message     TEXT,
  -- Device-observed time. Kept separate from server time on purpose: device
  -- clocks drift and a field event's real observation time is operationally
  -- meaningful even when it disagrees with the server.
  client_created_at TIMESTAMPTZ,
  -- Device-local monotonic counter, used to preserve intra-device ordering
  -- independently of arrival order.
  local_sequence    BIGINT,
  server_received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  server_processed_at TIMESTAMPTZ,
  PRIMARY KEY (operation_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_operations_device
  ON sync_operations (org_id, device_id, server_received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_operations_entity
  ON sync_operations (org_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_operations_status
  ON sync_operations (org_id, status) WHERE status IN ('claimed','conflict');

ALTER TABLE sync_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_operations_org_isolation ON sync_operations;
CREATE POLICY sync_operations_org_isolation ON sync_operations
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ─────────────────────────────────────────────────────────────────────────────
-- Conflict ledger — the losing local event is preserved, never dropped
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID         NOT NULL,
  operation_id      UUID         NOT NULL,
  device_id         TEXT         NOT NULL,
  user_id           UUID         REFERENCES users(id),
  entity_type       TEXT         NOT NULL,
  entity_id         TEXT         NOT NULL,
  -- What the device believed the entity looked like when it acted.
  expected_revision BIGINT,
  actual_revision   BIGINT,
  local_payload     JSONB        NOT NULL,
  server_snapshot   JSONB,
  reason            TEXT         NOT NULL,
  resolution        TEXT         NOT NULL DEFAULT 'unresolved'
                    CHECK (resolution IN ('unresolved','kept_server','applied_local','dismissed')),
  resolved_by       UUID         REFERENCES users(id),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_open
  ON sync_conflicts (org_id, created_at DESC) WHERE resolution = 'unresolved';
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_device
  ON sync_conflicts (org_id, device_id);

ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_conflicts_org_isolation ON sync_conflicts;
CREATE POLICY sync_conflicts_org_isolation ON sync_conflicts
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ─────────────────────────────────────────────────────────────────────────────
-- Change feed
-- ─────────────────────────────────────────────────────────────────────────────
-- A dedicated sequence rather than BIGSERIAL on the table so the ordering
-- semantics are explicit: `seq` is the client's checkpoint and nothing else
-- may reuse or reset it.
CREATE SEQUENCE IF NOT EXISTS sync_change_seq;

CREATE TABLE IF NOT EXISTS sync_change_log (
  seq          BIGINT       PRIMARY KEY DEFAULT nextval('sync_change_seq'),
  org_id       UUID         NOT NULL,
  entity_type  TEXT         NOT NULL,
  entity_id    TEXT         NOT NULL,
  operation    TEXT         NOT NULL CHECK (operation IN ('insert','update','delete')),
  revision     BIGINT,
  changed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- The pull query is always "org + entity_type in (...) + seq > checkpoint".
CREATE INDEX IF NOT EXISTS idx_sync_change_log_pull
  ON sync_change_log (org_id, seq);
CREATE INDEX IF NOT EXISTS idx_sync_change_log_entity
  ON sync_change_log (org_id, entity_type, entity_id, seq DESC);
-- Retention pruning scans by age.
CREATE INDEX IF NOT EXISTS idx_sync_change_log_age
  ON sync_change_log (changed_at);

ALTER TABLE sync_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_change_log_org_isolation ON sync_change_log;
CREATE POLICY sync_change_log_org_isolation ON sync_change_log
  USING (org_id = current_setting('app.current_org_id', true)::UUID);

-- ─────────────────────────────────────────────────────────────────────────────
-- Revision columns — optimistic concurrency for the state entities a field
-- device is allowed to change while offline.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cds_bookings   ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE cds_containers ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE cds_trips      ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE convoys        ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;

-- Bump on every UPDATE, unconditionally. Doing it in a trigger rather than in
-- each UPDATE statement means an existing route that knows nothing about sync
-- still produces a correct revision, which is what keeps this additive.
CREATE OR REPLACE FUNCTION sync_bump_revision() RETURNS TRIGGER AS $$
BEGIN
  NEW.revision := COALESCE(OLD.revision, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Record every change to a replicated entity on the change feed.
--
-- Soft deletes are the norm in this schema (`deleted_at`), and a device must
-- treat one as a removal, not as an ordinary field update — otherwise a booking
-- deleted while the device was offline stays visible in the field forever.
CREATE OR REPLACE FUNCTION sync_log_change() RETURNS TRIGGER AS $$
DECLARE
  v_op       TEXT;
  v_org      UUID;
  v_id       TEXT;
  v_revision BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_op  := 'delete';
    v_org := OLD.org_id;
    v_id  := OLD.id::TEXT;
  ELSE
    v_org := NEW.org_id;
    v_id  := NEW.id::TEXT;

    -- TG_ARGV[1] says whether this table carries a `revision` column. Reading
    -- NEW.revision on a table without one is a hard error in PL/pgSQL, so the
    -- answer is baked in when the trigger is created rather than probed here.
    IF TG_ARGV[1] = 'true' THEN
      v_revision := NEW.revision;
    END IF;

    IF TG_OP = 'INSERT' THEN
      v_op := 'insert';
    ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_op := 'delete';
    ELSE
      v_op := 'update';
    END IF;
  END IF;

  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO sync_change_log (org_id, entity_type, entity_id, operation, revision)
  VALUES (v_org, TG_ARGV[0], v_id, v_op, v_revision);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attach to the replicated set. Deliberately small: these are the entities a
-- field device actually needs offline. Adding a table here is the one change
-- required to extend replication, and it is the only place that decides it.
DO $$
DECLARE
  t        TEXT;
  ent      TEXT;
  has_rev  BOOLEAN;
  pairs TEXT[][] := ARRAY[
    ARRAY['cds_bookings',   'cds_booking'],
    ARRAY['cds_containers', 'cds_container'],
    ARRAY['cds_trips',      'cds_trip'],
    ARRAY['convoys',        'convoy'],
    ARRAY['vehicles',       'vehicle'],
    ARRAY['cds_incidents',  'cds_incident'],
    ARRAY['cds_geofences',  'cds_geofence']
  ];
BEGIN
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    t   := pairs[i][1];
    ent := pairs[i][2];

    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'revision'
    ) INTO has_rev;

    IF has_rev THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_sync_revision_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION sync_bump_revision()',
        'trg_sync_revision_' || t, t
      );
    END IF;

    -- Named with a 'z' prefix so it sorts after trg_sync_revision_*: PostgreSQL
    -- fires same-timing triggers in name order, and the change log must record
    -- the revision the BEFORE trigger just assigned.
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'ztrg_sync_log_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION sync_log_change(%L, %L)',
      'ztrg_sync_log_' || t, t, ent, has_rev::TEXT
    );
  END LOOP;
END $$;
