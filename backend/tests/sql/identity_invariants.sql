-- Database invariant test for the Identity & Security Centre.
-- Runs inside a transaction and always rolls back; it creates no test residue.
BEGIN;

DO $$
DECLARE
  test_org_id UUID := gen_random_uuid();
  admin_a UUID := gen_random_uuid();
  admin_b UUID := gen_random_uuid();
  guard_blocked BOOLEAN := false;
BEGIN
  INSERT INTO users (id, org_id, email, name, password_hash, role, status)
  VALUES
    (admin_a, test_org_id, lower(admin_a::text) || '@identity-test.invalid', 'Identity Guard A', 'test-hash', 'admin', 'active'),
    (admin_b, test_org_id, lower(admin_b::text) || '@identity-test.invalid', 'Identity Guard B', 'test-hash', 'admin', 'active');

  -- 'inactive' must be a valid persisted status, not merely a UI value.
  UPDATE users SET status = 'inactive' WHERE id = admin_a;

  IF (SELECT COUNT(*) FROM users u WHERE u.org_id = test_org_id AND u.role = 'admin' AND u.status = 'active' AND u.deleted_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'identity invariant setup failed: expected one active administrator';
  END IF;

  BEGIN
    UPDATE users SET status = 'suspended' WHERE id = admin_b;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    guard_blocked := SQLERRM = 'last_active_admin_protected';
  END;

  IF NOT guard_blocked THEN
    RAISE EXCEPTION 'identity invariant failed: last active administrator was not protected';
  END IF;
END;
$$;

ROLLBACK;
