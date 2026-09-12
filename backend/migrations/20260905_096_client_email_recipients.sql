-- Client email recipients are independent from portal login accounts.
-- They can receive Sonalit operational/security mail and/or CDS Client Pulse.
CREATE TABLE IF NOT EXISTS client_email_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  company TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sonalit_operational BOOLEAN NOT NULL DEFAULT TRUE,
  sonalit_security BOOLEAN NOT NULL DEFAULT FALSE,
  cds_client_pulse BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_client_email_recipients_org
  ON client_email_recipients (org_id, enabled)
  WHERE deleted_at IS NULL;

ALTER TABLE client_email_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_email_recipients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation_client_email_recipients ON client_email_recipients;
CREATE POLICY org_isolation_client_email_recipients
  ON client_email_recipients
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON client_email_recipients TO sonalit_app;
