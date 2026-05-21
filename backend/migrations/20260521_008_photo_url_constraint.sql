-- T3.7: Prevent data URIs from being stored in photo_url columns.
-- The backfill cron must be run to zero before applying this.

ALTER TABLE field_reports
  ADD CONSTRAINT field_reports_photo_url_no_data_uri
  CHECK (photo_url NOT LIKE 'data:%');

ALTER TABLE convoy_truck_photos
  ADD CONSTRAINT convoy_truck_photos_photo_url_no_data_uri
  CHECK (photo_url NOT LIKE 'data:%');
