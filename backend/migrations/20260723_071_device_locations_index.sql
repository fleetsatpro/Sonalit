-- device_locations holds every GPS point every Guardian device uploads (all
-- activity, convoy or not), so it grows fast and is now queried per-device over
-- a time window by the 3D drive-replay track endpoint. Without this index that
-- lookup degrades to a full scan as the table grows. ("timestamp" is quoted —
-- it's the column name, which shadows the type keyword.)
CREATE INDEX IF NOT EXISTS idx_device_locations_device_time
  ON device_locations (device_id, "timestamp" DESC);
