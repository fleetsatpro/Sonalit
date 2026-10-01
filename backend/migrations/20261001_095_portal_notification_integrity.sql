-- Portal notification preference integrity.
-- client_notification_prefs intentionally has no created_at column, so existing
-- duplicate global rows are reconciled deterministically by retaining the
-- lexicographically smallest UUID before enforcing the new unique boundary.
BEGIN;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY client_id, org_id
           ORDER BY id ASC
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
