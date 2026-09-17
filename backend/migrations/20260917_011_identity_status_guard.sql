-- Identity safety follow-up.
-- The legacy admin delete endpoint already uses status='inactive', while the
-- original users table only allowed active/suspended. Make the persisted
-- contract explicit and prevent the Identity Centre from creating an invalid
-- database value.
BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active','inactive','suspended'));

COMMIT;
