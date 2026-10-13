-- PostGIS is optional: some hosted PostgreSQL images do not ship its native
-- extension binaries. Corridor geometry now uses a bounded application-side
-- topology union and does not require any database extension.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'postgis'
  ) THEN
    RAISE NOTICE 'PostGIS is available; Sonalit corridor generation does not depend on it.';
  ELSE
    RAISE NOTICE 'PostGIS binaries are unavailable; Sonalit corridors use the application-side topology union.';
  END IF;
END
$$;
