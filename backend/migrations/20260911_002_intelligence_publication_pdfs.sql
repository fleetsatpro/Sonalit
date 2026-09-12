-- Intelligence publication PDF orchestration.
-- PDFs are derived artefacts of the governed intel_publications record and are stored in R2.
ALTER TABLE intel_publications ADD COLUMN IF NOT EXISTS pdf_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE intel_publications ADD COLUMN IF NOT EXISTS pdf_key TEXT;
ALTER TABLE intel_publications ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE intel_publications ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ;
ALTER TABLE intel_publications ADD COLUMN IF NOT EXISTS pdf_error TEXT;
ALTER TABLE intel_publications ADD COLUMN IF NOT EXISTS pdf_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS intel_publications_pdf_queue ON intel_publications(org_id, status, pdf_status, published_at DESC);

CREATE TABLE IF NOT EXISTS intel_publication_pdf_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  publication_id UUID NOT NULL REFERENCES intel_publications(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('map','image','illustration')),
  source_url TEXT,
  source_label TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intel_publication_pdf_assets_pub ON intel_publication_pdf_assets(org_id, publication_id, created_at DESC);
ALTER TABLE intel_publication_pdf_assets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intel_publication_pdf_assets' AND policyname='intel_publication_pdf_assets_org_isolation') THEN
    CREATE POLICY intel_publication_pdf_assets_org_isolation ON intel_publication_pdf_assets USING (org_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON intel_publication_pdf_assets TO sonalit_app;
