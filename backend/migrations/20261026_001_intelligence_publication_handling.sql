-- Auditable publication handling metadata (FIRST TLP 2.0).
-- Existing and legacy publications remain explicitly unmarked until an authorized
-- operator records handling. Never backfill a guessed distribution level.
BEGIN;

CREATE TABLE IF NOT EXISTS intel_publication_handling_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  publication_id UUID NOT NULL REFERENCES intel_publications(id) ON DELETE CASCADE,
  previous_handling JSONB,
  next_handling JSONB NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 1000),
  changed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intel_publication_handling_audit_history
  ON intel_publication_handling_audit(org_id,publication_id,created_at DESC);

ALTER TABLE intel_publication_handling_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='intel_publication_handling_audit'
      AND policyname='intel_publication_handling_audit_org_isolation'
  ) THEN
    CREATE POLICY intel_publication_handling_audit_org_isolation
      ON intel_publication_handling_audit
      USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT ON intel_publication_handling_audit TO sonalit_app;

COMMIT;
