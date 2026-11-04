-- A manifest may introduce a container before asset ownership documents
-- have been checked. Preserve that distinction instead of silently assuming
-- an auto-created record is leased.
ALTER TABLE cds_containers
  DROP CONSTRAINT IF EXISTS cds_containers_ownership_check;

ALTER TABLE cds_containers
  ADD CONSTRAINT cds_containers_ownership_check
  CHECK (ownership IN ('owned','leased','customer','unverified'));
