-- Intelligence publication quality v2.
-- Previously published products that were generated without complete incident
-- research are downgraded to draft and their cached PDFs are invalidated.
BEGIN;

UPDATE intel_publications
SET status='draft',
    published_at=NULL,
    pdf_status='not_requested',
    pdf_key=NULL,
    pdf_url=NULL,
    pdf_generated_at=NULL,
    pdf_error=NULL,
    pdf_version=COALESCE(pdf_version,1)+1,
    updated_at=NOW()
WHERE status='published'
  AND COALESCE((body->'release_gate'->>'research_release_gate')::boolean, false) = false;

COMMIT;
