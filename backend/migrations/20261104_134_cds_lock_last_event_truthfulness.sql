-- last_event_at is also telemetry provenance. A freshly created lock had
-- NOW() even though no hardware event had ever been observed.
ALTER TABLE cds_electronic_locks
  ALTER COLUMN last_event_at DROP DEFAULT;

UPDATE cds_electronic_locks l
   SET last_event_at = NULL
 WHERE NOT EXISTS (
   SELECT 1
     FROM cds_lock_events e
    WHERE e.lock_id = l.id
      AND e.org_id = l.org_id
 );
