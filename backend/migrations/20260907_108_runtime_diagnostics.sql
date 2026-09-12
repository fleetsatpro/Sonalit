-- Durable runtime diagnostics: critical operational events survive Railway log rotation/redeploys.
-- Deliberately service-wide (not org-scoped): this table is only exposed through
-- the admin-only diagnostics API and is never granted directly to end users.
CREATE TABLE IF NOT EXISTS runtime_diagnostics (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL DEFAULT 'backend',
  environment TEXT NOT NULL DEFAULT COALESCE(current_setting('app.environment', true), 'production'),
  level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error','fatal')),
  event TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  org_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runtime_diagnostics_occurred
  ON runtime_diagnostics (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_diagnostics_level_occurred
  ON runtime_diagnostics (level, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_diagnostics_event_occurred
  ON runtime_diagnostics (event, occurred_at DESC);

-- Keep the table bounded without relying on ephemeral Railway filesystem logs.
-- The cleanup job is application-side so deployments do not require pg_cron.
GRANT SELECT, INSERT, UPDATE, DELETE ON runtime_diagnostics TO sonalit_app;
GRANT USAGE, SELECT ON SEQUENCE runtime_diagnostics_id_seq TO sonalit_app;
