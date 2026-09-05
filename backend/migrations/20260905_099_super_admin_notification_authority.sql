-- Global Super Admin notification authority.
-- Super Admin recipients are organization-scoped identities with global visibility.
-- The initial operator is reconciled from the existing users table; future
-- operators (for example ops@sonalit.com) are added by configuration, not code.

ALTER TABLE client_email_recipients
  ADD COLUMN IF NOT EXISTS authority_role TEXT NOT NULL DEFAULT 'client'
  CHECK (authority_role IN ('super_admin','admin','client'));

CREATE INDEX IF NOT EXISTS idx_client_email_recipients_authority
  ON client_email_recipients (org_id, authority_role, enabled)
  WHERE deleted_at IS NULL;

-- Promote the current Super Admin identity in every organization where that
-- authenticated operator already exists. ON CONFLICT preserves an existing
-- recipient identity and only changes its authority classification.
INSERT INTO client_email_recipients (
  org_id, email, name, enabled, sonalit_operational, sonalit_security, cds_client_pulse, authority_role
)
SELECT
  u.org_id,
  lower(trim(u.email)),
  COALESCE(NULLIF(trim(u.name), ''), 'Griffin Onyari'),
  true, true, true, true, 'super_admin'
FROM users u
WHERE lower(trim(u.email)) = 'griffinonyari@gmail.com'
  AND u.org_id IS NOT NULL
  AND COALESCE(u.status, 'active') = 'active'
  AND u.deleted_at IS NULL
ON CONFLICT (org_id, lower(email)) DO UPDATE
SET authority_role='super_admin', enabled=true, sonalit_operational=true,
    sonalit_security=true, cds_client_pulse=true, updated_at=NOW();

COMMENT ON COLUMN client_email_recipients.authority_role IS
  'Notification authority: super_admin has global visibility; admin is organization/global Fleet authority; client is asset/customer scoped.';
