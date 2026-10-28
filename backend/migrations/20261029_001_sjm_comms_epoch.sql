-- Rotate private mission chat channels when the assigned team changes.
-- Keep this as a new migration so environments that already ran SJM 003
-- still receive the revocation epoch without modifying migration history.
-- Seed generation 1 for existing journeys to invalidate legacy base-channel
-- tokens issued before channel-generation enforcement was deployed.
BEGIN;
ALTER TABLE public.sjm_journeys
  ADD COLUMN IF NOT EXISTS comms_epoch BIGINT NOT NULL DEFAULT 1 CHECK (comms_epoch >= 0);
ALTER TABLE public.sjm_journeys ALTER COLUMN comms_epoch SET DEFAULT 1;
UPDATE public.sjm_journeys SET comms_epoch = 1 WHERE comms_epoch = 0;
COMMIT;
