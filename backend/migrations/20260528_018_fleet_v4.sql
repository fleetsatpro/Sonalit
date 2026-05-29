-- Fleet V4 — vehicles enhancements + vehicle_documents table
-- Idempotent: guarded throughout with IF NOT EXISTS / DO $$ checks.

-- ── 1. Add new columns to vehicles ───────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'odometer_km'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN odometer_km NUMERIC(12,1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'fuel_capacity_l'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN fuel_capacity_l NUMERIC(8,1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'utilisation_pct'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN utilisation_pct NUMERIC(5,2)
      CHECK (utilisation_pct >= 0 AND utilisation_pct <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'current_driver_id'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN current_driver_id UUID
      REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 2. Extend vehicles status CHECK to include 'retired' and 'inactive' ──────

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_status_check;

ALTER TABLE vehicles ADD CONSTRAINT vehicles_status_check
  CHECK (status IN ('idle','active','maintenance','offline','retired','inactive'));

-- ── 3. Create vehicle_documents table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL,
  vehicle_id   UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type         VARCHAR(50) NOT NULL CHECK (type IN ('insurance','roadworthy','registration','permit','inspection','other')),
  label        VARCHAR(128) NOT NULL,
  file_key     TEXT NOT NULL,
  expires_at   DATE,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   TIMESTAMPTZ
);

-- ── 4. Indexes for vehicle_documents ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle
  ON vehicle_documents(vehicle_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_org
  ON vehicle_documents(org_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_expiry
  ON vehicle_documents(expires_at) WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

-- ── 5. RLS on vehicle_documents ───────────────────────────────────────────────

ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation ON vehicle_documents;

CREATE POLICY org_isolation ON vehicle_documents
  FOR ALL
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_documents TO sonalit_app;
