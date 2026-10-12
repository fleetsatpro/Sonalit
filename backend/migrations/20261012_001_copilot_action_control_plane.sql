-- Durable Copilot action receipts, idempotency and privacy-safe tool traces.
-- Decision rows also use request_id so approval and execution update one durable conversation receipt.
BEGIN;

ALTER TABLE public.copilot_decisions
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_copilot_decisions_org_request
  ON public.copilot_decisions(org_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.copilot_action_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  request_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  command TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_hash TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('pending_confirmation','executing','succeeded','failed','denied','expired')),
  expires_at TIMESTAMPTZ,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT copilot_action_runs_org_request_unique UNIQUE (org_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_copilot_action_runs_org_created
  ON public.copilot_action_runs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_action_runs_org_status
  ON public.copilot_action_runs(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_action_runs_pending_expiry
  ON public.copilot_action_runs(expires_at)
  WHERE status = 'pending_confirmation';

CREATE TABLE IF NOT EXISTS public.copilot_tool_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  request_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed','denied','pending_confirmation')),
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  provider TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT copilot_tool_traces_request_ordinal_unique UNIQUE (org_id, request_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_copilot_tool_traces_org_created
  ON public.copilot_tool_traces(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_tool_traces_request
  ON public.copilot_tool_traces(org_id, request_id, ordinal);

ALTER TABLE public.copilot_action_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_action_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_tool_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_tool_traces FORCE ROW LEVEL SECURITY;

-- Permissive base policies grant access only within the active tenant. The
-- separate restrictive hardening policies are required by Sonalit's global
-- tenant-isolation contract and remain authoritative if a permissive policy
-- is added or broadened in a later migration.
DROP POLICY IF EXISTS copilot_action_runs_org_isolation ON public.copilot_action_runs;
CREATE POLICY copilot_action_runs_org_isolation ON public.copilot_action_runs
  AS PERMISSIVE FOR ALL
  USING (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''))
  WITH CHECK (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''));

DROP POLICY IF EXISTS copilot_tool_traces_org_isolation ON public.copilot_tool_traces;
CREATE POLICY copilot_tool_traces_org_isolation ON public.copilot_tool_traces
  AS PERMISSIVE FOR ALL
  USING (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''))
  WITH CHECK (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''));

DROP POLICY IF EXISTS tenant_isolation_hardening ON public.copilot_action_runs;
CREATE POLICY tenant_isolation_hardening ON public.copilot_action_runs
  AS RESTRICTIVE FOR ALL
  USING (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''))
  WITH CHECK (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''));

DROP POLICY IF EXISTS tenant_isolation_hardening ON public.copilot_tool_traces;
CREATE POLICY tenant_isolation_hardening ON public.copilot_tool_traces
  AS RESTRICTIVE FOR ALL
  USING (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''))
  WITH CHECK (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''));

GRANT SELECT, INSERT, UPDATE ON public.copilot_decisions TO sonalit_app;
GRANT SELECT, INSERT, DELETE ON public.copilot_decision_agents TO sonalit_app;
GRANT SELECT, INSERT, UPDATE ON public.copilot_action_runs TO sonalit_app;
GRANT SELECT, INSERT ON public.copilot_tool_traces TO sonalit_app;

COMMIT;
