-- Final idempotent repair for notification authority schema drift.
-- Do not rely on schema_migrations history here: these ALTERs are intentionally
-- repeated with a new migration filename so a previously marked migration
-- cannot hide a missing production column.

ALTER TABLE client_email_recipients
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES cargo_clients(id);

ALTER TABLE client_email_recipients
  ADD COLUMN IF NOT EXISTS authority_role TEXT NOT NULL DEFAULT 'client';

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES cargo_clients(id);

ALTER TABLE guardian_devices
  ADD COLUMN IF NOT EXISTS org_id UUID;

ALTER TABLE guardian_devices
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES cargo_clients(id);

ALTER TABLE communication_enrollments
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES cargo_clients(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='client_email_recipients_authority_role_check'
  ) THEN
    ALTER TABLE client_email_recipients
      ADD CONSTRAINT client_email_recipients_authority_role_check
      CHECK (authority_role IN ('super_admin','admin','client'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_email_recipients_client
  ON client_email_recipients (org_id, client_id, enabled)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_email_recipients_authority
  ON client_email_recipients (org_id, authority_role, enabled)
  WHERE deleted_at IS NULL;
