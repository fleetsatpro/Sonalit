-- The container register resolves the most recent booking-manifest row by
-- organisation + container number. Without this partial index, that lookup
-- scans every booking-container record for each visible inventory row.
CREATE INDEX IF NOT EXISTS idx_cds_booking_containers_container_latest
  ON cds_booking_containers (
    org_id,
    container_number,
    (COALESCE(clamped_at, updated_at, created_at)) DESC,
    id DESC
  )
  WHERE deleted_at IS NULL AND container_number IS NOT NULL;
