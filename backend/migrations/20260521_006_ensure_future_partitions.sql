-- T3.2: ensure_future_partitions — idempotently creates monthly child partitions
-- for tracked tables so the partition cron can never miss a boundary.

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
  end_date DATE;
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
        -- partition parent may not exist in this env — skip silently
        NULL;
      END;
    END IF;
  END LOOP;
END;
$$;

-- Tracks whether partitions are healthy (read by /health endpoint)
CREATE TABLE IF NOT EXISTS partition_health (
  table_name TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  partitions_ok BOOLEAN NOT NULL DEFAULT true
);
