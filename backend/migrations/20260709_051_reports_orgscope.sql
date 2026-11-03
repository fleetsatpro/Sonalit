-- Reports: add org scoping + generation metadata
-- The reports table had no org_id and no RLS policy at all — every
-- organization's generated reports were visible to every other
-- organization. Bring it in line with the org_isolation pattern used
-- elsewhere (e.g. shifts, geofences).

ALTER TABLE reports ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS format VARCHAR(10) NOT NULL DEFAULT 'PDF';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ready';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS period_from DATE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS period_to DATE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;

-- Legacy rows predate org_id and are orphaned by definition — RLS filters
-- them out for everyone rather than guessing an owner, matching the
-- fail-closed approach used for geofences.
DROP POLICY IF EXISTS org_isolation ON reports;
CREATE POLICY org_isolation ON reports
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON reports TO sonalit_app;

CREATE INDEX IF NOT EXISTS idx_reports_org_created ON reports (org_id, created_at DESC);
