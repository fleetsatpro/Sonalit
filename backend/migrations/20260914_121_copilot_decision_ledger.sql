-- Sonalit Copilot decision ledger: durable swarm runs, evidence health,
-- specialist findings, safety gates, and outcome feedback.
BEGIN;

CREATE TABLE IF NOT EXISTS public.copilot_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  user_id UUID,
  command TEXT NOT NULL,
  decision TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  answer TEXT NOT NULL DEFAULT '',
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  outcome TEXT,
  outcome_notes TEXT,
  outcome_recorded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_copilot_decisions_org_created
  ON public.copilot_decisions(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.copilot_decision_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES public.copilot_decisions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  provider TEXT,
  finding TEXT,
  dissent TEXT,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copilot_agents_decision
  ON public.copilot_decision_agents(decision_id, created_at);

CREATE TABLE IF NOT EXISTS public.copilot_decision_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES public.copilot_decisions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  user_id UUID,
  outcome TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copilot_feedback_org
  ON public.copilot_decision_feedback(org_id, created_at DESC);

ALTER TABLE public.copilot_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_decision_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_decision_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_decisions_org_isolation ON public.copilot_decisions;
CREATE POLICY copilot_decisions_org_isolation ON public.copilot_decisions
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS copilot_decision_agents_org_isolation ON public.copilot_decision_agents;
CREATE POLICY copilot_decision_agents_org_isolation ON public.copilot_decision_agents
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS copilot_feedback_org_isolation ON public.copilot_decision_feedback;
CREATE POLICY copilot_feedback_org_isolation ON public.copilot_decision_feedback
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

COMMIT;
