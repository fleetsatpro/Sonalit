-- DOWN for 20260904_093_trip_departure.sql
--
-- Drops only what the UP added. departed_at itself predates this migration and
-- is left alone, so trips that departed keep the fact — only the record of HOW
-- it was established, and the yard anchor, are lost.
--
-- NOTE: dropping clamp_lat/clamp_lng removes the anchor that departure
-- derivation reads. After this, only manual departure works.

DROP INDEX IF EXISTS idx_cds_trips_awaiting_departure;

ALTER TABLE cds_trips
  DROP COLUMN IF EXISTS clamp_lng,
  DROP COLUMN IF EXISTS clamp_lat,
  DROP COLUMN IF EXISTS departure_note,
  DROP COLUMN IF EXISTS departed_by,
  DROP COLUMN IF EXISTS departure_source;
