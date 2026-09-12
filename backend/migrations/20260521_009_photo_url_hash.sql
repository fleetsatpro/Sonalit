-- T5.2: photo deduplication — store SHA-256 of photo URL per convoy+session
-- Wrapped in DO block: on a fresh database the table is created later by 015b
-- (which already includes this column and index), so this is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'convoy_truck_photos') THEN
    ALTER TABLE convoy_truck_photos ADD COLUMN IF NOT EXISTS photo_url_hash TEXT;
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_convoy_truck_photos_hash
      ON convoy_truck_photos (convoy_id, session, photo_url_hash)
      WHERE photo_url_hash IS NOT NULL';
  END IF;
END $$;
