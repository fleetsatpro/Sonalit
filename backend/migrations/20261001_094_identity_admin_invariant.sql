-- Identity status contract + database-enforced last-active-admin invariant.
-- The API may reject unsafe changes early, but the database trigger closes the
-- concurrency race between two simultaneous administrator changes.
BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active','inactive','suspended'));

CREATE OR REPLACE FUNCTION enforce_last_active_admin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_admins INTEGER;
BEGIN
  IF (
    (TG_OP = 'DELETE'
      AND OLD.role = 'admin'
      AND OLD.status = 'active'
      AND OLD.deleted_at IS NULL)
    OR
    (TG_OP = 'UPDATE'
      AND OLD.role = 'admin'
      AND OLD.status = 'active'
      AND OLD.deleted_at IS NULL
      AND (
        NEW.role <> 'admin'
        OR NEW.status <> 'active'
        OR NEW.deleted_at IS NOT NULL
        OR NEW.org_id IS DISTINCT FROM OLD.org_id
      ))
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.org_id::text, 11731));

    SELECT COUNT(*)::int
      INTO active_admins
      FROM users
     WHERE org_id = OLD.org_id
       AND role = 'admin'
       AND status = 'active'
       AND deleted_at IS NULL;

    IF active_admins < 1 THEN
      RAISE EXCEPTION 'last_active_admin_protected'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS users_last_active_admin_guard ON users;
CREATE TRIGGER users_last_active_admin_guard
AFTER UPDATE OF org_id, role, status, deleted_at OR DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION enforce_last_active_admin_guard();

COMMIT;
