-- Runtime repair for security incident maps.
-- Production device_locations uses `heading`; the map renderer reads `bearing`.
-- 106 may already exist in migration history without having altered every legacy DB,
-- so this migration is intentionally idempotent and reasserts the compatibility column.
ALTER TABLE device_locations
  ADD COLUMN IF NOT EXISTS bearing DECIMAL(8,2);

UPDATE device_locations
SET bearing = heading
WHERE bearing IS NULL
  AND heading IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_locations_device_timestamp_bearing
  ON device_locations (device_id, timestamp DESC)
  WHERE bearing IS NOT NULL;
