-- Ensure production has the PostGIS functions required for robust,
-- chunked geodesic corridor creation. Earlier bootstrap DDL treated PostGIS
-- as optional and swallowed install failures, silently enabling a fragile ring.
CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
DECLARE
  postgis_schema text;
BEGIN
  SELECT namespace.nspname
    INTO postgis_schema
    FROM pg_catalog.pg_extension AS extension
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = extension.extnamespace
   WHERE extension.extname = 'postgis';

  IF postgis_schema IS NULL THEN
    RAISE EXCEPTION 'PostGIS is required for safe route-corridor polygon generation';
  END IF;

  -- Do not assume the provider installs PostGIS in public. Subsequent function
  -- resolution in this transaction must use the namespace recorded by pg_extension.
  PERFORM pg_catalog.set_config(
    'search_path',
    pg_catalog.quote_ident(postgis_schema) || ', pg_catalog, public',
    true
  );

  IF to_regprocedure('st_makepoint(double precision,double precision)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS function ST_MakePoint(double precision, double precision) is unavailable';
  END IF;

  IF to_regprocedure('st_segmentize(geography,double precision)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS function ST_Segmentize(geography, double precision) is unavailable';
  END IF;

  IF to_regprocedure('st_buffer(geography,double precision,text)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS function ST_Buffer(geography, double precision, text) is unavailable';
  END IF;

  -- PostGIS exposes the grid-size overload with a default value, so the
  -- callable single-argument SQL form resolves to this two-argument signature.
  IF to_regprocedure('st_unaryunion(geometry,double precision)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS function ST_UnaryUnion(geometry, double precision) is unavailable';
  END IF;

  IF to_regprocedure('st_covers(geometry,geometry)') IS NULL OR
     to_regprocedure('st_isvalid(geometry)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS validity/coverage functions are unavailable';
  END IF;
END
$$;
