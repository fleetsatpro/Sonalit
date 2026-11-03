-- Extend persisted SJM report artifacts while preserving the original applied migration.
-- Management summary reports are tenant-wide snapshots and therefore have no single journey_id.
BEGIN;
ALTER TABLE public.sjm_reports ALTER COLUMN journey_id DROP NOT NULL;
ALTER TABLE public.sjm_reports DROP CONSTRAINT IF EXISTS sjm_reports_report_type_check;
ALTER TABLE public.sjm_reports
  ADD CONSTRAINT sjm_reports_report_type_check
  CHECK (report_type IN ('itinerary','pre_trip_brief','daily','sitrep','change_notice','closeout','final','management_summary'));
CREATE INDEX IF NOT EXISTS idx_sjm_management_reports_org_date
  ON public.sjm_reports(org_id, report_date DESC)
  WHERE report_type='management_summary';
COMMIT;
