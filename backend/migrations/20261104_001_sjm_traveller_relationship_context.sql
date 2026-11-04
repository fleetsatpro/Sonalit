-- Relationship context improves duty planning without adding new identity credentials.
-- Values remain manager-only under the existing SJM traveller access boundary.
BEGIN;
ALTER TABLE public.sjm_travellers
  ADD COLUMN IF NOT EXISTS relationship_to_principal TEXT
    CHECK (relationship_to_principal IS NULL OR length(relationship_to_principal)<=80),
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship TEXT
    CHECK (emergency_contact_relationship IS NULL OR length(emergency_contact_relationship)<=80);
COMMIT;
