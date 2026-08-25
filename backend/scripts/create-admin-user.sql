-- Recreate an admin login on a database that has schema but no users.
-- The schema has no organizations table: users.org_id is a plain UUID column
-- defaulting to the single-tenant org 00000000-0000-0000-0000-000000000001.
-- crypt(..., gen_salt('bf')) emits a $2a$ bcrypt hash, which the backend's
-- bcryptjs compare() accepts. Requires the pgcrypto extension (migration 000).
--
-- Change the password immediately after logging in.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (email, name, password_hash, role, status)
VALUES (
  'admin@sonalit.com',
  'Administrator',
  crypt('AdminPassword123!', gen_salt('bf')),
  'admin',
  'active'
)
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      role          = 'admin',
      status        = 'active',
      deleted_at    = NULL,
      updated_at    = NOW();

SELECT id, email, name, role, status, org_id FROM users WHERE email = 'admin@sonalit.com';
