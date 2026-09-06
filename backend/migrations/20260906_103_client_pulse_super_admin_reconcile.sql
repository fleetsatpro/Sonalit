-- Final reconciliation: ensure the configured Super Admin identity exists as a
-- Client Pulse recipient even when it was created after migration 099 ran.
-- Customer recipients remain strictly exact-email + organization scoped.

INSERT INTO client_email_recipients (
  org_id, email, name, enabled, sonalit_operational, sonalit_security,
  cds_client_pulse, authority_role
)
SELECT
  u.org_id,
  lower(trim(u.email)),
  COALESCE(NULLIF(trim(u.name), ''), 'Griffin Onyari'),
  TRUE, TRUE, TRUE, TRUE, 'super_admin'
FROM users u
WHERE lower(trim(u.email))='griffinonyari@gmail.com'
  AND u.org_id IS NOT NULL
  AND COALESCE(u.status,'active')='active'
  AND u.deleted_at IS NULL
ON CONFLICT (org_id,email) DO UPDATE SET
  enabled=TRUE,
  sonalit_operational=TRUE,
  sonalit_security=TRUE,
  cds_client_pulse=TRUE,
  authority_role='super_admin',
  deleted_at=NULL,
  updated_at=NOW();

-- Re-run the exact customer binding repair after the Super Admin reconciliation.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, org_id, email
      FROM client_email_recipients
     WHERE deleted_at IS NULL AND enabled IS TRUE
       AND cds_client_pulse IS TRUE AND email IS NOT NULL
  LOOP
    PERFORM sonalit_bind_cds_client_pulse_recipient(r.org_id,r.id,r.email);
  END LOOP;
END;
$$;
