-- Newly provisioned e-locks are assigned/installed before the hardware has
-- delivered a verified heartbeat. Defaults such as 100% battery, strong
-- signal and NOW() heartbeat made an unreported device look healthy.
ALTER TABLE cds_electronic_locks
  ALTER COLUMN battery_level DROP NOT NULL,
  ALTER COLUMN battery_level DROP DEFAULT,
  ALTER COLUMN signal_strength DROP NOT NULL,
  ALTER COLUMN signal_strength DROP DEFAULT,
  ALTER COLUMN last_heartbeat DROP DEFAULT;

-- Remove values that could only have come from the old defaults and have no
-- recorded heartbeat evidence. Do not erase measurements accompanied by a
-- recorded heartbeat event.
UPDATE cds_electronic_locks l
   SET battery_level = NULL,
       signal_strength = NULL,
       last_heartbeat = NULL
 WHERE NOT EXISTS (
   SELECT 1 FROM cds_lock_events e
    WHERE e.lock_id = l.id
      AND e.org_id = l.org_id
      AND e.type = 'heartbeat'
 );
