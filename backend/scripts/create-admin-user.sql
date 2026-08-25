-- Create admin organization
WITH org_insert AS (
  INSERT INTO organizations (id, name, slug, created_at, updated_at)
  VALUES (
    'org-' || gen_random_uuid()::text,
    'Admin Organization',
    'admin-org',
    NOW(),
    NOW()
  )
  RETURNING id
)
-- Create admin user with the organization
INSERT INTO users (
  id,
  email,
  name,
  password_hash,
  role,
  org_id,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  'admin@sonalit.com',
  'Administrator',
  crypt('AdminPassword123!', gen_salt('bf')),
  'admin',
  org_insert.id,
  NOW(),
  NOW()
FROM org_insert;

-- Verify user was created
SELECT id, email, name, role, org_id FROM users WHERE role = 'admin' LIMIT 1;
