-- Fix convoy_cfo_truck_assignments: base schema (000) creates this table
-- without convoy_truck_id — only id, convoy_id, cfo_user_id. Migration 015b
-- has the full schema but uses CREATE TABLE IF NOT EXISTS, which is a no-op
-- when 000 already created the table. This leaves the column missing and
-- guardianCfo.js /context 500s on "column ccta.convoy_truck_id does not exist".

BEGIN;

ALTER TABLE convoy_cfo_truck_assignments
  ADD COLUMN IF NOT EXISTS convoy_truck_id UUID REFERENCES convoy_trucks(id) ON DELETE CASCADE;

ALTER TABLE convoy_cfo_truck_assignments
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- The unique constraints and trigger from 015b may also be missing.
-- Use DO blocks to skip if they already exist.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'convoy_cfo_truck_assignments_convoy_id_cfo_user_id_convoy__key'
      AND conrelid = 'convoy_cfo_truck_assignments'::regclass
  ) THEN
    BEGIN
      ALTER TABLE convoy_cfo_truck_assignments
        ADD CONSTRAINT convoy_cfo_truck_assignments_convoy_id_cfo_user_id_convoy__key
        UNIQUE (convoy_id, cfo_user_id, convoy_truck_id);
    EXCEPTION WHEN duplicate_table THEN NULL;
    END;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ccta_truck
  ON convoy_cfo_truck_assignments (convoy_truck_id);

CREATE INDEX IF NOT EXISTS idx_convoy_cfo_truck_asgn
  ON convoy_cfo_truck_assignments (convoy_id, cfo_user_id);

CREATE OR REPLACE FUNCTION enforce_cfo_truck_limit() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM convoy_cfo_truck_assignments
       WHERE convoy_id = NEW.convoy_id AND cfo_user_id = NEW.cfo_user_id) >= 2 THEN
    RAISE EXCEPTION 'cfo_truck_limit_exceeded: a CFO may cover at most 2 trucks in a convoy';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_enforce_cfo_truck_limit ON convoy_cfo_truck_assignments;
CREATE TRIGGER trg_enforce_cfo_truck_limit
  BEFORE INSERT ON convoy_cfo_truck_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_cfo_truck_limit();

COMMIT;
