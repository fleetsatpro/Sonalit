-- Bootstrap the legacy rules table before the 20260917_001 rules control-plane
-- migration. The control-plane migration intentionally promotes this table;
-- this file closes the ordering gap on restored/clean databases where `rules`
-- was missing entirely.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  name VARCHAR(255) NOT NULL,
  condition VARCHAR(100),
  action VARCHAR(100),
  condition_type VARCHAR(100),
  threshold NUMERIC,
  action_type VARCHAR(100),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority VARCHAR(50) NOT NULL DEFAULT 'medium',
  cooldown_minutes INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rules_org_created
  ON rules (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rules_org_active
  ON rules (org_id, enabled, updated_at DESC)
  WHERE deleted_at IS NULL;
