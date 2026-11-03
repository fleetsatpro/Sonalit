-- Retire guardian_devices rows orphaned before the retire-on-re-enroll fix
-- (099f792a). When an officer's phone re-enrolled, the old device row was
-- never revoked: it lingers with the officer's last position and a stale (or
-- NULL) last_seen, drawing a permanent OFFLINE ghost marker on Live Fleet GPS
-- — frequently at almost exactly the same coordinates as the live device, so
-- the ghost sits on top of (or instead of) the marker that is actually alive.
--
-- Keeper per (org, name) group: the freshest row by (last_seen, created_at).
-- Everything else in the group is revoked, same shape as
-- DELETE /guardian/devices/:id (soft delete). Officer-linked rows are never
-- retired regardless — if a linked row is somehow staler than an unlinked
-- twin, both survive and that group is left for a human to untangle.
UPDATE guardian_devices gd
SET deleted_at = NOW(), status = 'revoked', updated_at = NOW()
WHERE gd.deleted_at IS NULL
  -- never touch a device an officer is actively linked to
  AND NOT EXISTS (
    SELECT 1 FROM field_officers fo WHERE fo.device_id = gd.id
  )
  AND EXISTS (
    SELECT 1 FROM guardian_devices keeper
    WHERE keeper.deleted_at IS NULL
      AND keeper.id <> gd.id
      AND keeper.name = gd.name
      AND keeper.org_id IS NOT DISTINCT FROM gd.org_id
      AND (
        -- the strictly fresher twin wins (created_at/id tie-break keeps the
        -- ordering total, so exactly one row per group survives)
        COALESCE(keeper.last_seen, 'epoch'::timestamptz) > COALESCE(gd.last_seen, 'epoch'::timestamptz)
        OR (COALESCE(keeper.last_seen, 'epoch'::timestamptz) = COALESCE(gd.last_seen, 'epoch'::timestamptz)
            AND (keeper.created_at, keeper.id) > (gd.created_at, gd.id))
      )
  );
