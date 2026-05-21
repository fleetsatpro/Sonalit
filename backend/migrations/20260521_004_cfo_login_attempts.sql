-- T1.5 — CFO device PIN brute-force tracking
BEGIN;

CREATE TABLE IF NOT EXISTS cfo_login_attempts (
  device_id    UUID        PRIMARY KEY,
  attempts     INTEGER     NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cfo_login_attempts_locked ON cfo_login_attempts(locked_until)
  WHERE locked_until IS NOT NULL;

COMMIT;
