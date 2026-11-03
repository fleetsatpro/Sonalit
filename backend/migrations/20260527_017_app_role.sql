-- Create non-superuser application role so RLS org_isolation policies are
-- enforced even when the session connects as a PostgreSQL superuser.
-- withOrg() does SET LOCAL ROLE sonalit_app within each transaction.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sonalit_app') THEN
    CREATE ROLE sonalit_app NOLOGIN NOSUPERUSER INHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sonalit_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sonalit_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO sonalit_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sonalit_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sonalit_app;

-- Allow the sonalit session user to SET ROLE sonalit_app
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sonalit') THEN
    EXECUTE 'GRANT sonalit_app TO sonalit';
  END IF;
END $$;
