-- T3.5: Idempotency keys cache — stores request/response pairs for 24h.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key          TEXT         NOT NULL,
  org_id       TEXT,
  status_code  INT          NOT NULL,
  response     JSONB        NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (key, org_id)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);
