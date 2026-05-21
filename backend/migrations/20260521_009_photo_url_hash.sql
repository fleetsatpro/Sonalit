-- T5.2: photo deduplication — store SHA-256 of photo URL per convoy+session
ALTER TABLE convoy_truck_photos
  ADD COLUMN IF NOT EXISTS photo_url_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_convoy_truck_photos_hash
  ON convoy_truck_photos (convoy_id, session, photo_url_hash)
  WHERE photo_url_hash IS NOT NULL;
