-- Migration: 20260611_044_pegagent_commands_ack
-- Adds latency_ms to device_commands and battery_low_alert event type
-- for PEGAGENT command acknowledgement flow.

ALTER TABLE device_commands
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER;

-- Extend officer_activity_events check constraint to include battery_low_alert.
-- Drop existing constraint and recreate with expanded list.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'officer_activity_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE officer_activity_events DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE officer_activity_events
  ADD CONSTRAINT oae_event_type_check
  CHECK (event_type IN (
    'sos_triggered', 'sos_resolved', 'checkin', 'photo_submitted',
    'seal_verified', 'geofence_breach', 'report_generated',
    'mission_started', 'mission_completed', 'device_offline',
    'device_online', 'command_issued', 'command_acked', 'battery_low_alert'
  ));
