-- custody_events: verifiable custody ledger for convoy handoffs and checkpoints

CREATE TABLE IF NOT EXISTS custody_events (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID         NOT NULL,
  convoy_id   UUID         NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  seq         INTEGER      NOT NULL,
  kind        TEXT         NOT NULL
              CHECK (kind IN ('departure','checkpoint','handoff','seal_check','arrival','exception')),
  location    TEXT         CHECK (char_length(location) <= 256),
  officer     TEXT         CHECK (char_length(officer) <= 128),
  seal_intact BOOLEAN,
  hash        CHAR(64)     NOT NULL,
  prev_hash   CHAR(64),
  notes       TEXT         CHECK (char_length(notes) <= 512),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (convoy_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_custody_convoy ON custody_events(convoy_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_custody_org    ON custody_events(org_id);

ALTER TABLE custody_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON custody_events
  USING (org_id = current_setting('app.current_org_id', true)::uuid);
