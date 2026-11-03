-- Guardian bootstrap tenant-schema reconciliation.
-- Existing deployments may already have enrollment_codes / convoy_codes from the
-- base schema without org_id. CREATE TABLE IF NOT EXISTS does not alter those
-- legacy tables, which can otherwise make tenant-policy creation fail at startup.
-- Idempotent and intentionally fail-closed for rows whose owner cannot be resolved.

BEGIN;

ALTER TABLE IF EXISTS public.enrollment_codes
  ADD COLUMN IF NOT EXISTS org_id UUID;

ALTER TABLE IF EXISTS public.convoy_codes
  ADD COLUMN IF NOT EXISTS org_id UUID;

UPDATE public.enrollment_codes ec
SET org_id = u.org_id
FROM public.users u
WHERE ec.created_by = u.id
  AND ec.org_id IS NULL
  AND u.org_id IS NOT NULL;

UPDATE public.convoy_codes cc
SET org_id = u.org_id
FROM public.users u
WHERE cc.created_by = u.id
  AND cc.org_id IS NULL
  AND u.org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollment_codes_org_created
  ON public.enrollment_codes(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_convoy_codes_org_created
  ON public.convoy_codes(org_id, created_at DESC);

COMMIT;
