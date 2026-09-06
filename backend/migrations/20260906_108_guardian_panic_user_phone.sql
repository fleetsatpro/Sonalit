-- Guardian panic escalation compatibility repair.
-- The panic escalation path expects an optional users.phone field for
-- WhatsApp escalation, but the production users table does not currently
-- define it. Keep the field nullable so existing users are unaffected and
-- panic escalation never fails at the database layer.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE INDEX IF NOT EXISTS idx_users_org_role_phone
  ON users (org_id, role)
  WHERE phone IS NOT NULL;
