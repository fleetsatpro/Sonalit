-- Portal notification preference integrity.
-- Preserve the newest global preference per client/org, then enforce a
-- transaction-safe uniqueness boundary for future global saves.
BEGIN;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY client_id, org_id
           ORDER BY created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM client_notification_prefs
  WHERE convoy_id IS NULL
)
DELETE FROM client_notification_prefs p
 USING ranked r
 WHERE p.id = r.id
   AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_client_notification_prefs_global
  ON client_notification_prefs (client_id, org_id)
  WHERE convoy_id IS NULL;

COMMIT;
