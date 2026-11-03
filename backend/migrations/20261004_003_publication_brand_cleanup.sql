-- Retire a legacy publication-facing label without embedding the retired term in source.
-- Existing publication prose is scrubbed and cached PDFs are invalidated so they
-- cannot be served with obsolete branding after this migration.
BEGIN;

UPDATE intel_publications
SET title = regexp_replace(title, '\y' || chr(51) || '[iI]' || '\y', '', 'gi'),
    subtitle = regexp_replace(subtitle, '\y' || chr(51) || '[iI]' || '\y', '', 'gi'),
    executive_assessment = regexp_replace(executive_assessment, '\y' || chr(51) || '[iI]' || '\y', '', 'gi'),
    body = CASE
      WHEN body IS NULL THEN body
      ELSE regexp_replace(body::text, '\y' || chr(51) || '[iI]' || '\y', '', 'gi')::jsonb
    END,
    pdf_status = 'not_requested',
    pdf_key = NULL,
    pdf_url = NULL,
    pdf_generated_at = NULL,
    pdf_error = NULL,
    pdf_version = COALESCE(pdf_version, 1) + 1,
    updated_at = NOW()
WHERE title ~* ('\y' || chr(51) || '[iI]' || '\y')
   OR subtitle ~* ('\y' || chr(51) || '[iI]' || '\y')
   OR executive_assessment ~* ('\y' || chr(51) || '[iI]' || '\y')
   OR body::text ~* ('\y' || chr(51) || '[iI]' || '\y');

UPDATE intel_publication_pdf_assets
SET source_label = regexp_replace(source_label, '\y' || chr(51) || '[iI]' || '\y', '', 'gi')
WHERE source_label ~* ('\y' || chr(51) || '[iI]' || '\y');

COMMIT;
