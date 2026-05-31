-- portal_documents: document vault entries for cargo clients (per convoy)

CREATE TABLE IF NOT EXISTS portal_documents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  convoy_id   UUID        NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  type        TEXT        NOT NULL
              CHECK (type IN ('custody_chain','proof_of_delivery','manifest','customs','insurance','seal_report')),
  label       TEXT        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 128),
  file_url    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_portal_docs_convoy ON portal_documents(convoy_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_docs_org    ON portal_documents(org_id)    WHERE deleted_at IS NULL;

ALTER TABLE portal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON portal_documents
  USING (org_id = current_setting('app.current_org_id', true)::uuid);
