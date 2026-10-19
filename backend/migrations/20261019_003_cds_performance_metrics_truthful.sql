-- Retain exact schema-default-shaped performance values for later reconciliation,
-- but do not report them as measured until a source-backed metric pipeline exists.
CREATE TABLE IF NOT EXISTS public.cds_metric_reconciliation_archive (
  org_id UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer','driver','transporter')),
  entity_id UUID NOT NULL,
  metric_name TEXT NOT NULL,
  prior_value JSONB NOT NULL,
  reason TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id, metric_name)
);
COMMENT ON TABLE public.cds_metric_reconciliation_archive IS
  'Restricted archive of unverified legacy metric values removed from active CDS performance fields; preserve, do not use as live metrics.';

ALTER TABLE public.cds_customers
  ALTER COLUMN sla_compliance DROP DEFAULT,
  ALTER COLUMN sla_compliance DROP NOT NULL,
  ALTER COLUMN rating DROP DEFAULT,
  ALTER COLUMN rating DROP NOT NULL;
ALTER TABLE public.cds_drivers
  ALTER COLUMN rating DROP DEFAULT,
  ALTER COLUMN rating DROP NOT NULL;
ALTER TABLE public.cds_transporters
  ALTER COLUMN on_time_rate DROP DEFAULT,
  ALTER COLUMN on_time_rate DROP NOT NULL,
  ALTER COLUMN avg_clamp_time DROP DEFAULT,
  ALTER COLUMN rating DROP DEFAULT,
  ALTER COLUMN rating DROP NOT NULL,
  ALTER COLUMN performance_score DROP DEFAULT,
  ALTER COLUMN performance_score DROP NOT NULL;

INSERT INTO public.cds_metric_reconciliation_archive
  (org_id, entity_type, entity_id, metric_name, prior_value, reason)
SELECT org_id, 'customer', id, 'sla_compliance', to_jsonb(sla_compliance),
       'Legacy schema default or source-unverified value; no evidence-backed metric writer exists.'
  FROM public.cds_customers WHERE sla_compliance = 100.00
ON CONFLICT DO NOTHING;
INSERT INTO public.cds_metric_reconciliation_archive
  (org_id, entity_type, entity_id, metric_name, prior_value, reason)
SELECT org_id, 'customer', id, 'rating', to_jsonb(rating),
       'Legacy schema default or source-unverified value; no evidence-backed rating writer exists.'
  FROM public.cds_customers WHERE rating = 5.00
ON CONFLICT DO NOTHING;
INSERT INTO public.cds_metric_reconciliation_archive
  (org_id, entity_type, entity_id, metric_name, prior_value, reason)
SELECT org_id, 'driver', id, 'rating', to_jsonb(rating),
       'Legacy schema default or source-unverified value; no evidence-backed rating writer exists.'
  FROM public.cds_drivers WHERE rating = 5.00
ON CONFLICT DO NOTHING;
INSERT INTO public.cds_metric_reconciliation_archive
  (org_id, entity_type, entity_id, metric_name, prior_value, reason)
SELECT org_id, 'transporter', id, 'on_time_rate', to_jsonb(on_time_rate),
       'Legacy schema default or source-unverified value; no evidence-backed on-time metric writer exists.'
  FROM public.cds_transporters WHERE on_time_rate = 100.00
ON CONFLICT DO NOTHING;
INSERT INTO public.cds_metric_reconciliation_archive
  (org_id, entity_type, entity_id, metric_name, prior_value, reason)
SELECT org_id, 'transporter', id, 'avg_clamp_time', to_jsonb(avg_clamp_time),
       'Legacy schema default or source-unverified value; no evidence-backed clamp-time metric writer exists.'
  FROM public.cds_transporters WHERE avg_clamp_time = '0m'
ON CONFLICT DO NOTHING;
INSERT INTO public.cds_metric_reconciliation_archive
  (org_id, entity_type, entity_id, metric_name, prior_value, reason)
SELECT org_id, 'transporter', id, 'rating', to_jsonb(rating),
       'Legacy schema default or source-unverified value; no evidence-backed rating writer exists.'
  FROM public.cds_transporters WHERE rating = 5.00
ON CONFLICT DO NOTHING;
INSERT INTO public.cds_metric_reconciliation_archive
  (org_id, entity_type, entity_id, metric_name, prior_value, reason)
SELECT org_id, 'transporter', id, 'performance_score', to_jsonb(performance_score),
       'Legacy schema default or source-unverified value; no evidence-backed performance-score writer exists.'
  FROM public.cds_transporters WHERE performance_score = 100.00
ON CONFLICT DO NOTHING;

UPDATE public.cds_customers SET sla_compliance = NULL WHERE sla_compliance = 100.00;
UPDATE public.cds_customers SET rating = NULL WHERE rating = 5.00;
UPDATE public.cds_drivers SET rating = NULL WHERE rating = 5.00;
UPDATE public.cds_transporters SET on_time_rate = NULL WHERE on_time_rate = 100.00;
UPDATE public.cds_transporters SET avg_clamp_time = NULL WHERE avg_clamp_time = '0m';
UPDATE public.cds_transporters SET rating = NULL WHERE rating = 5.00;
UPDATE public.cds_transporters SET performance_score = NULL WHERE performance_score = 100.00;

-- This archive is for controlled reconciliation, never a tenant-facing API.
-- Keep the tenant boundary and FORCE RLS invariant identical to other public tenant tables.
ALTER TABLE public.cds_metric_reconciliation_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cds_metric_reconciliation_archive FORCE ROW LEVEL SECURITY;
DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='cds_metric_reconciliation_archive'
      AND policyname='tenant_isolation_hardening'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_hardening
        ON public.cds_metric_reconciliation_archive
        AS RESTRICTIVE
        FOR ALL
        USING (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''))
        WITH CHECK (org_id::text = NULLIF(current_setting('app.current_org_id', true), ''))
    $policy$;
  END IF;
END $;
