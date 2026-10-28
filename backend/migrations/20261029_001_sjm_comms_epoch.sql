-- Rotate private mission chat channels when the assigned team changes.
-- Keep this as a new migration so environments that already ran SJM 003
-- still receive the revocation epoch without modifying migration history.
BEGIN;
ALTER TABLE public.sjm_journeys
  ADD COLUMN IF NOT EXISTS comms_epoch BIGINT NOT NULL DEFAULT 0 CHECK (comms_epoch >= 0);
COMMIT;
