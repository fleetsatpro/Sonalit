-- Break-glass: recreate an admin login on a database that has schema but no
-- usable admin account.
--
-- Usage (never inline the password — let the shell prompt for it):
--   read -rsp 'admin password: ' PW && echo
--   psql "$DATABASE_URL" -v admin_password="$PW" -f scripts/create-admin-user.sql
--   unset PW
--
-- Optional: -v admin_email=someone@example.com  (default admin@sonalit.com)
--           -v admin_name='Administrator'
--
-- The schema has no organizations table: users.org_id is a plain UUID column
-- defaulting to the single-tenant org 00000000-0000-0000-0000-000000000001.
--
-- crypt(..., gen_salt('bf', 10)) emits a $2a$10$ bcrypt hash at the same cost
-- the app's bcryptjs uses in authController.changePassword. Requires pgcrypto
-- (migration 000).

\set ON_ERROR_STOP on

\if :{?admin_password}
\else
\echo 'ERROR: admin_password is not set.'
\echo 'Run:  psql "$DATABASE_URL" -v admin_password="$PW" -f scripts/create-admin-user.sql'
\quit
\endif

\if :{?admin_email}
\else
\set admin_email 'admin@sonalit.com'
\endif

\if :{?admin_name}
\else
\set admin_name 'Administrator'
\endif

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (email, name, password_hash, role, status)
VALUES (
  :'admin_email',
  :'admin_name',
  crypt(:'admin_password', gen_salt('bf', 10)),
  'admin',
  'active'
)
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      role          = 'admin',
      status        = 'active',
      deleted_at    = NULL,
      updated_at    = NOW();

-- Verify the stored hash actually validates the password that was just set.
-- password_matches must be t; if it is f, do not bother trying to log in.
SELECT email,
       role,
       status,
       org_id,
       left(password_hash, 7) AS hash_prefix,
       password_hash = crypt(:'admin_password', password_hash) AS password_matches
  FROM users
 WHERE email = :'admin_email';
