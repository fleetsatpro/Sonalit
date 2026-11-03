-- Customer Authority Control Plane
-- A client is the security boundary; recipients are people; enrollments are
-- domain-scoped authority; distribution lists are reusable recipient groups;
-- subscriptions remain the granular event/channel rights.
-- The model is deliberately additive so existing notification delivery keeps
-- working while operators gain safe multi-recipient management.

CREATE TABLE IF NOT EXISTS communication_distribution_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  domain TEXT NOT NULL CHECK (domain IN ('platform','fleet','cds')),
  client_id UUID REFERENCES cargo_clients(id),
  cds_customer_id UUID REFERENCES cds_customers(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT communication_distribution_list_scope CHECK (
    (domain='platform' AND client_id IS NULL AND cds_customer_id IS NULL)
    OR (domain='fleet' AND client_id IS NOT NULL AND cds_customer_id IS NULL)
    OR (domain='cds' AND client_id IS NULL AND cds_customer_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_communication_distribution_list_name
  ON communication_distribution_lists (org_id, domain,
    COALESCE(client_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(cds_customer_id,'00000000-0000-0000-0000-000000000000'::uuid),
    lower(name));
CREATE INDEX IF NOT EXISTS idx_communication_distribution_lists_scope
  ON communication_distribution_lists (org_id, domain, client_id, cds_customer_id, status);

CREATE TABLE IF NOT EXISTS communication_distribution_list_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  distribution_list_id UUID NOT NULL REFERENCES communication_distribution_lists(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES communication_enrollments(id) ON DELETE CASCADE,
  added_by UUID,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (distribution_list_id, enrollment_id)
);
CREATE INDEX IF NOT EXISTS idx_communication_distribution_list_members_org
  ON communication_distribution_list_members (org_id, distribution_list_id);
CREATE INDEX IF NOT EXISTS idx_communication_distribution_list_members_enrollment
  ON communication_distribution_list_members (org_id, enrollment_id);

-- Membership is relationship-based authorization: a member may only be put
-- into a list when its enrollment exactly matches the list's security scope.
CREATE OR REPLACE FUNCTION validate_communication_distribution_member()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  l communication_distribution_lists%ROWTYPE;
  e communication_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO l FROM communication_distribution_lists WHERE id=NEW.distribution_list_id AND org_id=NEW.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'distribution_list_not_found'; END IF;
  SELECT * INTO e FROM communication_enrollments WHERE id=NEW.enrollment_id AND org_id=NEW.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'enrollment_not_found'; END IF;
  IF e.domain <> l.domain
     OR (l.domain='cds' AND e.cds_customer_id IS DISTINCT FROM l.cds_customer_id)
     OR (l.domain='fleet' AND e.client_id IS DISTINCT FROM l.client_id)
     OR l.status='archived'
  THEN
    RAISE EXCEPTION 'distribution_list_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_communication_distribution_member ON communication_distribution_list_members;
CREATE TRIGGER trg_validate_communication_distribution_member
BEFORE INSERT OR UPDATE ON communication_distribution_list_members
FOR EACH ROW EXECUTE FUNCTION validate_communication_distribution_member();

CREATE TABLE IF NOT EXISTS communication_authority_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  actor_user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  scope_domain TEXT,
  scope_client_id UUID,
  scope_cds_customer_id UUID,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_communication_authority_audit_scope
  ON communication_authority_audit (org_id, scope_domain, scope_client_id, scope_cds_customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communication_authority_audit_entity
  ON communication_authority_audit (org_id, entity_type, entity_id, created_at DESC);

ALTER TABLE communication_distribution_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_distribution_lists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_communication_distribution_lists ON communication_distribution_lists;
CREATE POLICY org_isolation_communication_distribution_lists
  ON communication_distribution_lists
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

ALTER TABLE communication_distribution_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_distribution_list_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_communication_distribution_list_members ON communication_distribution_list_members;
CREATE POLICY org_isolation_communication_distribution_list_members
  ON communication_distribution_list_members
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

ALTER TABLE communication_authority_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_authority_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_communication_authority_audit ON communication_authority_audit;
CREATE POLICY org_isolation_communication_authority_audit
  ON communication_authority_audit
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON communication_distribution_lists TO sonalit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON communication_distribution_list_members TO sonalit_app;
GRANT SELECT, INSERT ON communication_authority_audit TO sonalit_app;

COMMENT ON TABLE communication_distribution_lists IS 'Reusable customer-scoped recipient groups. Membership never crosses an enrollment security boundary.';
COMMENT ON TABLE communication_distribution_list_members IS 'Relationship between a scoped enrollment and a distribution list.';
COMMENT ON TABLE communication_authority_audit IS 'Append-only application audit trail for customer authority changes.';
