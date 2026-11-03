-- Finance + maintenance: add org scoping
--
-- trips, invoices, expenses and maintenance_records were created in the base
-- schema without org_id, so migration 001 skipped RLS on them (a table with
-- RLS enabled but no org_id column and no policy denies all rows). finance.js
-- and maintenance.js therefore queried them through the raw, unscoped
-- connection: every organization's invoices, expenses, trip costs and
-- maintenance history were mixed into one global list, and the /finance
-- dashboard + profitability aggregates summed across all tenants.
--
-- These four tables are only ever touched by finance.js / maintenance.js /
-- drivers.js (all moved onto req.db), so — unlike the mixed-access core tables
-- in migration 001 — it is safe to FORCE RLS here, matching the convention used
-- by every table added since migration 017 (portal, comms, shipments, ...).
--
-- Existing rows predate multi-tenancy (single default org); org_id is derived
-- from each row's natural owner where available and otherwise backfilled to the
-- legacy default org, exactly as migration 001 did for the core tables.

DO $$
DECLARE default_org UUID := '00000000-0000-0000-0000-000000000001';
BEGIN

  -- ── trips: org derived from the (NOT NULL) vehicle ──────────────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trips' AND column_name='org_id') THEN
    ALTER TABLE trips ADD COLUMN org_id UUID;
  END IF;
  UPDATE trips t SET org_id = v.org_id
    FROM vehicles v WHERE v.id = t.vehicle_id AND t.org_id IS NULL;
  EXECUTE format('UPDATE trips SET org_id = %L WHERE org_id IS NULL', default_org::text);
  ALTER TABLE trips ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
  ALTER TABLE trips ALTER COLUMN org_id SET NOT NULL;

  -- ── invoices: org derived from the creating user ────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='org_id') THEN
    ALTER TABLE invoices ADD COLUMN org_id UUID;
  END IF;
  UPDATE invoices i SET org_id = u.org_id
    FROM users u WHERE u.id = i.created_by AND u.org_id IS NOT NULL AND i.org_id IS NULL;
  EXECUTE format('UPDATE invoices SET org_id = %L WHERE org_id IS NULL', default_org::text);
  ALTER TABLE invoices ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
  ALTER TABLE invoices ALTER COLUMN org_id SET NOT NULL;

  -- ── expenses: org derived from the recording user ───────────────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='org_id') THEN
    ALTER TABLE expenses ADD COLUMN org_id UUID;
  END IF;
  UPDATE expenses e SET org_id = u.org_id
    FROM users u WHERE u.id = e.recorded_by AND u.org_id IS NOT NULL AND e.org_id IS NULL;
  EXECUTE format('UPDATE expenses SET org_id = %L WHERE org_id IS NULL', default_org::text);
  ALTER TABLE expenses ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
  ALTER TABLE expenses ALTER COLUMN org_id SET NOT NULL;

  -- ── maintenance_records: org derived from the creating user ─────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maintenance_records' AND column_name='org_id') THEN
    ALTER TABLE maintenance_records ADD COLUMN org_id UUID;
  END IF;
  UPDATE maintenance_records m SET org_id = u.org_id
    FROM users u WHERE u.id = m.created_by AND u.org_id IS NOT NULL AND m.org_id IS NULL;
  EXECUTE format('UPDATE maintenance_records SET org_id = %L WHERE org_id IS NULL', default_org::text);
  ALTER TABLE maintenance_records ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
  ALTER TABLE maintenance_records ALTER COLUMN org_id SET NOT NULL;

END $$;

-- ── Enable + FORCE RLS with the standard org_isolation policy ──────────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['trips', 'invoices', 'expenses', 'maintenance_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I
         USING (org_id = current_setting(''app.current_org_id'', true)::uuid)
         WITH CHECK (org_id = current_setting(''app.current_org_id'', true)::uuid)',
      tbl
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sonalit_app', tbl);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_trips_org    ON trips (org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses (org_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_maint_org    ON maintenance_records (org_id, scheduled_at DESC);
