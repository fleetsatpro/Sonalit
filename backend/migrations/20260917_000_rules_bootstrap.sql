-- Bootstrap the rules table before the 20260917_001 rules control-plane
-- migration. This closes the restore/ordering gap where the legacy table
-- itself is absent. All columns use the final control-plane types so 001 can
-- safely run with IF NOT EXISTS semantics.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  condition VARCHAR(100),
  action VARCHAR(100),
  condition_type VARCHAR(100),
  threshold NUMERIC,
  action_type VARCHAR(100),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER NOT NULL DEFAULT 50,
  severity TEXT NOT NULL DEFAULT 'medium',
  mode TEXT NOT NULL DEFAULT 'live',
  scope JSONB NOT NULL DEFAULT '{"type":"org"}'::jsonb,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  condition_logic TEXT NOT NULL DEFAULT 'all',
  schedule JSONB NOT NULL DEFAULT '{"enabled":false}'::jsonb,
  cooldown_seconds INTEGER NOT NULL DEFAULT 900,
  evaluation_window_seconds INTEGER NOT NULL DEFAULT 0,
  deduplication JSONB NOT NULL DEFAULT '{"strategy":"rule_subject","ttl_seconds":900}'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID,
  updated_by UUID,
  last_triggered_at TIMESTAMPTZ,
  trigger_count BIGINT NOT NULL DEFAULT 0,
  failure_count BIGINT NOT NULL DEFAULT 0,
  last_error TEXT,
  cooldown_minutes INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_org_created
  ON rules (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rules_org_active
  ON rules (org_id, enabled, updated_at DESC)
  WHERE deleted_at IS NULL;
