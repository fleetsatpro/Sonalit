-- Security incident map compatibility: the live device_locations schema stores
-- direction as `heading`, while the incident-map renderer currently reads `bearing`.
-- Keep both names available so existing GPS history remains renderable without
-- changing the authoritative telemetry schema.
ALTER TABLE device_locations
  ADD COLUMN IF NOT EXISTS bearing DECIMAL(8,2);

UPDATE device_locations
SET bearing = heading
WHERE bearing IS NULL
  AND heading IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_locations_device_timestamp_bearing
  ON device_locations (device_id, timestamp DESC)
  WHERE bearing IS NOT NULL;
