-- T1.6 — Hash chain on audit_logs + chain validation function
BEGIN;

-- Add hash chain columns to audit_logs
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hash      TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS org_id    UUID;

CREATE INDEX IF NOT EXISTS audit_log_org_id_id ON audit_logs(org_id, id DESC);

-- Chain validation function: returns true if the chain is unbroken for an org
CREATE OR REPLACE FUNCTION validate_audit_chain(p_org_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  prev TEXT := NULL;
  rec  RECORD;
  ok   BOOLEAN := TRUE;
BEGIN
  FOR rec IN
    SELECT hash, prev_hash FROM audit_logs
    WHERE org_id = p_org_id
    ORDER BY id ASC
  LOOP
    IF rec.prev_hash IS DISTINCT FROM prev THEN
      ok := FALSE;
      EXIT;
    END IF;
    prev := rec.hash;
  END LOOP;
  RETURN ok;
END;
$$;

COMMIT;
