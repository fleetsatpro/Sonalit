-- Communications Control Plane: recipient identity is separate from enrollment.
-- A recipient may be enrolled in Fleet, Platform, and/or a specific CDS customer.
-- This prevents generic org-wide flags from leaking CDS data across customers.

CREATE TABLE IF NOT EXISTS communication_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  recipient_id UUID NOT NULL REFERENCES client_email_recipients(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('platform','fleet','cds')),
  cds_customer_id UUID,
  contact_role TEXT,
  locale TEXT,
  timezone TEXT,
  status TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('draft','pending_verification','verified','active','suspended','revoked')),
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  suspended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT communication_enrollment_cds_scope CHECK (
    (domain = 'cds' AND cds_customer_id IS NOT NULL)
    OR (domain <> 'cds' AND cds_customer_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_communication_enrollment_scope
  ON communication_enrollments (org_id, recipient_id, domain, COALESCE(cds_customer_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_communication_enrollments_org_status
  ON communication_enrollments (org_id, domain, status);
CREATE INDEX IF NOT EXISTS idx_communication_enrollments_cds_customer
  ON communication_enrollments (org_id, cds_customer_id, status)
  WHERE domain = 'cds';

CREATE TABLE IF NOT EXISTS communication_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  enrollment_id UUID NOT NULL REFERENCES communication_enrollments(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','portal','web')),
  delivery_mode TEXT NOT NULL DEFAULT 'immediate' CHECK (delivery_mode IN ('immediate','digest','batched')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  critical_override BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enrollment_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_communication_subscriptions_org_event
  ON communication_subscriptions (org_id, event_type, enabled);
CREATE INDEX IF NOT EXISTS idx_communication_subscriptions_enrollment
  ON communication_subscriptions (enrollment_id, enabled);

CREATE TABLE IF NOT EXISTS communication_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  enrollment_id UUID,
  subscription_id UUID,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','skipped')),
  provider_message_id TEXT,
  correlation_id TEXT,
  payload_hash TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_communication_delivery_events_org_created
  ON communication_delivery_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communication_delivery_events_enrollment
  ON communication_delivery_events (enrollment_id, created_at DESC);

ALTER TABLE communication_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_enrollments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_communication_enrollments ON communication_enrollments;
CREATE POLICY org_isolation_communication_enrollments
  ON communication_enrollments
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

ALTER TABLE communication_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_communication_subscriptions ON communication_subscriptions;
CREATE POLICY org_isolation_communication_subscriptions
  ON communication_subscriptions
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

ALTER TABLE communication_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_delivery_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_communication_delivery_events ON communication_delivery_events;
CREATE POLICY org_isolation_communication_delivery_events
  ON communication_delivery_events
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON communication_enrollments TO sonalit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON communication_subscriptions TO sonalit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON communication_delivery_events TO sonalit_app;

-- Do not auto-enrol existing CDS recipients: an email/company match is not an
-- authoritative customer relationship. Existing recipients remain available
-- as identities until an operator explicitly binds them to the correct CDS customer.
COMMENT ON TABLE communication_enrollments IS 'Domain-specific communication enrollment. CDS enrollment must name an authoritative cds_customer_id.';
COMMENT ON TABLE communication_subscriptions IS 'Event/channel-level communication policy attached to an enrollment.';
COMMENT ON TABLE communication_delivery_events IS 'Immutable-ish delivery audit trail for communication fan-out.';
