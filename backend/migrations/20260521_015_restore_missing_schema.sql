-- Idempotently restores schema objects that may be absent in production
-- because migrations 001-005 contained embedded BEGIN/COMMIT statements
-- that broke the runner's transaction boundary, causing migration 006 content
-- to be skipped silently despite appearing in schema_migrations.
--
-- Safe to re-run: all statements use IF NOT EXISTS / CREATE OR REPLACE /
-- ON CONFLICT DO NOTHING.

-- From migration 006: partition infrastructure --

CREATE TABLE IF NOT EXISTS partition_retention (
  table_name     TEXT PRIMARY KEY,
  retain_months  INT  NOT NULL DEFAULT 12
);

INSERT INTO partition_retention (table_name, retain_months) VALUES
  ('gps_logs',   6),
  ('audit_logs', 24),
  ('outbox',     3)
ON CONFLICT (table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_future_partitions(p_table TEXT, months_ahead INT DEFAULT 3)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  i INT;
  partition_name TEXT;
  start_date DATE;
  end_date   DATE;
BEGIN
  FOR i IN 0..months_ahead LOOP
    start_date := DATE_TRUNC('month', NOW() + (i || ' months')::INTERVAL)::DATE;
    end_date   := (start_date + INTERVAL '1 month')::DATE;
    partition_name := p_table || '_' || TO_CHAR(start_date, 'YYYY_MM');

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = partition_name AND n.nspname = 'public'
    ) THEN
      BEGIN
        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          partition_name, p_table, start_date::TEXT, end_date::TEXT
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS partition_health (
  table_name    TEXT PRIMARY KEY,
  checked_at    TIMESTAMPTZ DEFAULT NOW(),
  partitions_ok BOOLEAN NOT NULL DEFAULT true
);

-- From migration 014: refresh tokens and GDPR columns --

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rt_user    ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rt_expires ON refresh_tokens(expires_at);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
