-- Backfill convoy org_id from the creating user's org_id.
-- Targets convoys that have the sentinel default UUID or NULL,
-- indicating they were created before org_id was set in the controller.
UPDATE convoys c
SET    org_id     = u.org_id,
       updated_at = NOW()
FROM   users u
WHERE  c.created_by = u.id
  AND  u.org_id IS NOT NULL
  AND  u.org_id != '00000000-0000-0000-0000-000000000001'
  AND  (c.org_id IS NULL OR c.org_id = '00000000-0000-0000-0000-000000000001')
  AND  c.deleted_at IS NULL;
