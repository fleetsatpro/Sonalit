-- Canonical publication-period deduplication.
-- Preserve historical duplicates as superseded records, then enforce one active
-- publication per tenant/country/type/period.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY org_id,country_code,publication_type,period_start,period_end
           ORDER BY
             CASE status WHEN 'published' THEN 2 WHEN 'review' THEN 1 WHEN 'draft' THEN 1 ELSE 0 END DESC,
             version DESC,
             updated_at DESC,
             created_at DESC,
             id DESC
         ) AS rn
  FROM intel_publications
  WHERE period_start IS NOT NULL
    AND period_end IS NOT NULL
)
UPDATE intel_publications p
SET status='superseded',
    updated_at=NOW()
FROM ranked r
WHERE p.id=r.id
  AND r.rn>1
  AND p.status IN ('draft','review','published');

CREATE UNIQUE INDEX IF NOT EXISTS intel_publications_active_period_unique
  ON intel_publications(org_id,country_code,publication_type,period_start,period_end)
  WHERE status IN ('draft','review','published');
