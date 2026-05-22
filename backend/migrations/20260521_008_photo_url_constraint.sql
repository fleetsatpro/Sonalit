-- T3.7: Prevent data URIs from being stored in photo_url columns.
-- Backfill: clear any existing data URIs before adding the constraints.
UPDATE field_reports SET photo_url = NULL WHERE photo_url LIKE 'data:%';

UPDATE convoy_truck_photos SET photo_url = '' WHERE photo_url LIKE 'data:%';

ALTER TABLE field_reports
  ADD CONSTRAINT IF NOT EXISTS field_reports_photo_url_no_data_uri
  CHECK (photo_url NOT LIKE 'data:%');

ALTER TABLE convoy_truck_photos
  ADD CONSTRAINT IF NOT EXISTS convoy_truck_photos_photo_url_no_data_uri
  CHECK (photo_url NOT LIKE 'data:%');
