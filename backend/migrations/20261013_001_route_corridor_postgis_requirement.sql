-- Historical migration retained for ledger compatibility.
-- Route corridors now use the validated route-centreline-distance-v1 model,
-- which requires no PostGIS extension or provider-specific server binaries.
-- Do not attempt CREATE EXTENSION here: managed PostgreSQL providers may not
-- include PostGIS in their server image, and this feature no longer depends on it.
SELECT 1;
