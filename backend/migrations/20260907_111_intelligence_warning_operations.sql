-- Intelligence trajectory, warning workflow, and operational exposure state.
CREATE TABLE IF NOT EXISTS intel_risk_trajectory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('country','region','corridor','entity','global')),
  scope_key TEXT NOT NULL,
  current_score NUMERIC(8,2) NOT NULL DEFAULT 0,
  direction TEXT NOT NULL CHECK (direction IN ('rising','stable','falling','unknown')),
  velocity NUMERIC(10,3) NOT NULL DEFAULT 0,
  acceleration NUMERIC(10,3) NOT NULL DEFAULT 0,
  persistence NUMERIC(8,3) NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  drivers JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_risk_trajectory_scope ON intel_risk_trajectory_snapshots(org_id,scope_type,scope_key,computed_at DESC);
ALTER TABLE intel_risk_trajectory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_warning_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  warning_id UUID NOT NULL REFERENCES intel_early_warnings(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('open','review','acknowledged','dismissed','expired')),
  disposition TEXT,
  notes TEXT,
  reasoning JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_warning_actions_warning ON intel_warning_actions(org_id,warning_id,created_at DESC);
ALTER TABLE intel_warning_actions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS intel_warning_exposures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  warning_id UUID NOT NULL REFERENCES intel_early_warnings(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  asset_id UUID,
  asset_name TEXT,
  exposure_type TEXT NOT NULL,
  exposure_score NUMERIC(8,2) NOT NULL DEFAULT 0,
  rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id,warning_id,asset_type,asset_id,exposure_type)
);
CREATE INDEX IF NOT EXISTS intel_warning_exposures_active ON intel_warning_exposures(org_id,exposure_score DESC,detected_at DESC);
ALTER TABLE intel_warning_exposures ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['intel_risk_trajectory_snapshots','intel_warning_actions','intel_warning_exposures'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname=t || '_org_isolation') THEN
      EXECUTE format('CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org_id'', true)::uuid)', t || '_org_isolation', t);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON intel_risk_trajectory_snapshots,intel_warning_actions,intel_warning_exposures TO sonalit_app;
