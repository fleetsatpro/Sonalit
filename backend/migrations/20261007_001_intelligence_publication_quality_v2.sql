-- Intelligence publication quality v2.
-- Previously published products that do not carry an explicit passing release
-- contract are downgraded to draft and any cached PDF is invalidated.
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
  AND NOT (
    COALESCE((body->'release_gate'->>'research_release_gate')::boolean, false)
    AND COALESCE((body->'release_gate'->>'tradecraft_quality_gate')::boolean, false)
    AND COALESCE((body->'publication_quality'->>'passed')::boolean, false)
  );

COMMIT;
