-- Capture-time location for covert photos. The device already has a GPS fix (it
-- runs a location foreground service), so a capture_photo can report where it was
-- taken. Persisting it here powers the Surveillance map view: every photo becomes
-- a pin, filterable and reverse-geocodable, instead of a placeless thumbnail.
-- Falls back to the device's last known position (guardian_devices.last_lat/lng)
-- for rows that arrive without a fix. Nullable — older rows stay NULL.
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE guardian_captures ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
