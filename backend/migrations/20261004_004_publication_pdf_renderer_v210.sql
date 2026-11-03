-- Force regeneration of already-cached publication PDFs after the v2.1 professional renderer.
-- Old PDFs must never remain "ready" once the renderer contract changes.
BEGIN;

UPDATE intel_publications
SET
  pdf_status = 'not_requested',
  pdf_key = NULL,
  pdf_url = NULL,
  pdf_generated_at = NULL,
  pdf_error = NULL,
  pdf_version = COALESCE(pdf_version, 1) + 1,
  updated_at = NOW()
WHERE status = 'published'
  AND pdf_status = 'ready';

COMMIT;
