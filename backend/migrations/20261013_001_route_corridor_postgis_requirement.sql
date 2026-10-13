-- Ensure the production database has the PostGIS functions required for
-- robust, chunked geodesic route-corridor construction. An earlier bootstrap
-- migration treated PostGIS as optional and swallowed all CREATE EXTENSION
-- errors; that allowed the API to silently fall back to a fragile offset ring.
CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'PostGIS is required for safe route-corridor polygon generation';
  END IF;

  IF to_regprocedure('st_segmentize(geography,double precision)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS function ST_Segmentize(geography, double precision) is unavailable';
  END IF;

  IF to_regprocedure('st_buffer(geography,double precision,text)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS function ST_Buffer(geography, double precision, text) is unavailable';
  END IF;

  IF to_regprocedure('st_unaryunion(geometry)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS function ST_UnaryUnion(geometry) is unavailable';
  END IF;

  IF to_regprocedure('st_covers(geometry,geometry)') IS NULL OR
     to_regprocedure('st_isvalid(geometry)') IS NULL THEN
    RAISE EXCEPTION 'Required PostGIS validity/coverage functions are unavailable';
  END IF;
END
$$;
