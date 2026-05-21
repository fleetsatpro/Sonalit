-- T6.2: Composite index audit — add missing (org_id, col) indexes for hot-path queries

-- guardian_devices: list filtered by org + status, ordered by last_seen
CREATE INDEX IF NOT EXISTS idx_guardian_devices_org_status
  ON guardian_devices (org_id, status)
  WHERE org_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_guardian_devices_org_seen
  ON guardian_devices (org_id, last_seen DESC)
  WHERE org_id IS NOT NULL AND deleted_at IS NULL;

-- panic_events: list ordered by created_at per org
CREATE INDEX IF NOT EXISTS idx_panic_events_org_created
  ON panic_events (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

-- field_reports: list ordered by created_at per org, filtered by device
CREATE INDEX IF NOT EXISTS idx_field_reports_org_created
  ON field_reports (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;

-- device_command_events: look up by command_id (already covers JOIN; also add occurred_at sort)
-- idx_dce_command_id already exists — covered by migration 010

-- drivers: list by org + created_at (single-column org index exists, add sort index)
CREATE INDEX IF NOT EXISTS idx_drivers_org_created
  ON drivers (org_id, created_at DESC)
  WHERE org_id IS NOT NULL AND deleted_at IS NULL;

-- audit_logs: org_id + id already covered by audit_log_org_id_id from migration 001/005
-- Add (org_id, table_name, created_at) for filtered audit views
CREATE INDEX IF NOT EXISTS idx_audit_org_table
  ON audit_logs (org_id, table_name, created_at DESC)
  WHERE org_id IS NOT NULL;

-- idempotency_keys: PK is (key, org_id) which covers the lookup; add partial index for cleanup sweep
CREATE INDEX IF NOT EXISTS idx_idempotency_active
  ON idempotency_keys (org_id, expires_at)
  WHERE expires_at > NOW() - INTERVAL '1 day';
