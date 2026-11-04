-- A provider label is not telemetry. The old default assigned "securisat"
-- to every manually-created lock, even where there was no configured provider
-- or device heartbeat. Keep explicit provider evidence, but do not infer it
-- for records that have never emitted a hardware heartbeat.
ALTER TABLE cds_electronic_locks
  ALTER COLUMN provider SET DEFAULT 'unverified';

UPDATE cds_electronic_locks l
   SET provider = 'unverified'
 WHERE LOWER(BTRIM(l.provider)) = 'securisat'
   AND NOT EXISTS (
     SELECT 1
       FROM cds_lock_events e
      WHERE e.lock_id = l.id
        AND e.org_id = l.org_id
        AND e.type = 'heartbeat'
   );
