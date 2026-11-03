-- S2-F5: Insurance Claim Builder
-- RULE A: ENABLE + FORCE RLS + org_isolation

CREATE TABLE IF NOT EXISTS insurance_claims (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL,
  incident_id         UUID REFERENCES incidents(id) ON DELETE SET NULL,
  convoy_id           UUID REFERENCES convoys(id) ON DELETE SET NULL,
  vehicle_id          UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  claim_number        VARCHAR(100),
  status              VARCHAR(30) NOT NULL DEFAULT 'draft',
  -- draft → submitted → under_review → approved | rejected | withdrawn
  insurer_name        VARCHAR(200),
  policy_number       VARCHAR(100),
  incident_date       DATE,
  incident_location   VARCHAR(500),
  incident_description TEXT,
  damage_description  TEXT,
  estimated_value     NUMERIC(12,2),
  currency            VARCHAR(3) DEFAULT 'KES',
  police_ref          VARCHAR(100),
  witness_names       TEXT,
  attachments         JSONB DEFAULT '[]',
  submitted_at        TIMESTAMPTZ,
  reviewed_at         TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  resolution_note     TEXT,
  pdf_url             TEXT,
  pdf_generated_at    TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claims FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON insurance_claims;
CREATE POLICY org_isolation ON insurance_claims
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON insurance_claims TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_insurance_claims_org ON insurance_claims (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_incident ON insurance_claims (incident_id) WHERE incident_id IS NOT NULL;
