-- Sonalit Rules Control Plane
-- Expand the rules module from a simple threshold list into a versioned,
-- observable, multi-condition automation control plane.
BEGIN;

ALTER TABLE rules
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','paused','archived','error')),
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low','medium','high','critical')),
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'live'
    CHECK (mode IN ('live','dry_run')),
  ADD COLUMN IF NOT EXISTS scope JSONB NOT NULL DEFAULT '{"type":"org"}'::jsonb,
  ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS schedule JSONB NOT NULL DEFAULT '{"enabled":false}'::jsonb,
  ADD COLUMN IF NOT EXISTS cooldown_seconds INTEGER NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS evaluation_window_seconds INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deduplication JSONB NOT NULL DEFAULT '{"strategy":"rule_subject","ttl_seconds":900}'::jsonb,
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trigger_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE rules
  ALTER COLUMN threshold DROP NOT NULL;

CREATE INDEX IF NOT EXISTS rules_org_status_priority_idx
  ON rules (org_id, status, priority DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS rules_tags_gin_idx
  ON rules USING GIN (tags)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('create','update','enable','disable','restore')),
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rule_id, version)
);

CREATE INDEX IF NOT EXISTS rule_versions_org_rule_idx
  ON rule_versions (org_id, rule_id, version DESC);

CREATE TABLE IF NOT EXISTS rule_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  rule_version INTEGER NOT NULL,
  org_id UUID NOT NULL,
  correlation_id TEXT,
  subject_type TEXT,
  subject_id TEXT,
  event_type TEXT NOT NULL,
  event_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('live','dry_run')),
  matched BOOLEAN NOT NULL,
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  suppression_reason TEXT,
  decision_ms INTEGER,
  condition_trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rule_exec_org_time_idx
  ON rule_executions (org_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS rule_exec_rule_time_idx
  ON rule_executions (rule_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS rule_exec_subject_idx
  ON rule_executions (org_id, subject_type, subject_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS rule_action_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES rule_executions(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  action_index INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed','dead_letter')),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rule_deliveries_queue_idx
  ON rule_action_deliveries (status, available_at);

CREATE INDEX IF NOT EXISTS rule_deliveries_org_idx
  ON rule_action_deliveries (org_id, created_at DESC);

-- Backward-compatible seed: promote legacy scalar condition/action into the
-- richer arrays without overwriting rules that already have explicit arrays.
UPDATE rules
SET
  conditions = CASE
    WHEN jsonb_array_length(COALESCE(conditions, '[]'::jsonb)) = 0
         AND condition IS NOT NULL
      THEN jsonb_build_array(jsonb_build_object(
        'field', condition,
        'operator', 'trigger',
        'value', threshold
      ))
    ELSE COALESCE(conditions, '[]'::jsonb)
  END,
  actions = CASE
    WHEN jsonb_array_length(COALESCE(actions, '[]'::jsonb)) = 0
         AND action_type IS NOT NULL
      THEN jsonb_build_array(jsonb_build_object(
        'type', action_type
      ))
    ELSE COALESCE(actions, '[]'::jsonb)
  END
WHERE deleted_at IS NULL;

COMMIT;
