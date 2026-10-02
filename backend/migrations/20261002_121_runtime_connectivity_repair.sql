-- Runtime connectivity repair: reconcile legacy tenant UUIDs and Guardian schema.
-- Idempotent and safe to rerun. This repairs production databases where the
-- application bootstrap raced ahead of optional Guardian ALTER TABLE steps.

BEGIN;

ALTER TABLE IF EXISTS public.guardian_devices
  ADD COLUMN IF NOT EXISTS org_id UUID;

ALTER TABLE IF EXISTS public.panic_events
  ADD COLUMN IF NOT EXISTS org_id UUID;

UPDATE public.panic_events p
SET org_id = d.org_id
FROM public.guardian_devices d
WHERE p.device_id = d.id
  AND p.org_id IS NULL
  AND d.org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_panic_events_open_unacked
  ON public.panic_events(org_id, created_at)
  WHERE resolved_at IS NULL AND acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_panic_events_org_created
  ON public.panic_events(org_id, created_at DESC);

COMMIT;
