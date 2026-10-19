-- Analytics/archive catalog schema for Sonalit Option B.
-- IMPORTANT: apply only to the separate Railway database named sonalit_analytics.
-- It must NEVER be run against the operational database.
-- Read docs/architecture/storage-tiering-b-and-c.md before applying.
-- This file creates empty catalog/aggregate tables only; it does not copy or delete production data.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'sonalit_analytics' THEN
    RAISE EXCEPTION 'Refusing storage catalog migration: connected database is %, expected sonalit_analytics', current_database();
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.storage_archive_manifest (
  archive_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  data_class              TEXT NOT NULL CHECK (data_class IN (
                            'audit_log', 'telemetry', 'device_health', 'media_metadata',
                            'report_export', 'backup_snapshot', 'other_approved'
                          )),
  source_relation         TEXT NOT NULL,
  source_partition        TEXT,
  range_start             TIMESTAMPTZ,
  range_end               TIMESTAMPTZ,
  object_bucket           TEXT NOT NULL,
  object_key              TEXT NOT NULL,
  object_format           TEXT NOT NULL CHECK (object_format IN ('jsonl.gz', 'parquet', 'pdf', 'binary', 'other')),
  schema_version          TEXT NOT NULL,
  row_count               BIGINT NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  compressed_bytes        BIGINT CHECK (compressed_bytes IS NULL OR compressed_bytes >= 0),
  uncompressed_bytes      BIGINT CHECK (uncompressed_bytes IS NULL OR uncompressed_bytes >= 0),
  sha256_hex              CHAR(64) CHECK (sha256_hex IS NULL OR sha256_hex ~ '^[a-f0-9]{64}$'),
  retention_until         TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'planned'
                          CHECK (status IN ('planned', 'uploading', 'uploaded', 'verified',
                                            'source_released', 'failed', 'retention_hold')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at             TIMESTAMPTZ,
  verified_at             TIMESTAMPTZ,
  source_released_at      TIMESTAMPTZ,
  last_error_code         TEXT,
  last_error_summary      TEXT CHECK (last_error_summary IS NULL OR length(last_error_summary) <= 1000),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT storage_archive_range_valid CHECK (
    range_start IS NULL OR range_end IS NULL OR range_start <= range_end
  ),
  CONSTRAINT storage_archive_verified_before_release CHECK (
    status NOT IN ('verified', 'source_released') OR verified_at IS NOT NULL
  ),
  CONSTRAINT storage_archive_release_state CHECK (
    source_released_at IS NULL OR status = 'source_released'
  ),
  UNIQUE (object_bucket, object_key),
  UNIQUE (tenant_id, archive_id)
);

CREATE INDEX IF NOT EXISTS idx_storage_archive_tenant_status
  ON public.storage_archive_manifest (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_archive_retention
  ON public.storage_archive_manifest (retention_until)
  WHERE retention_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_storage_archive_source_range
  ON public.storage_archive_manifest (tenant_id, source_relation, range_start, range_end);

CREATE TABLE IF NOT EXISTS public.storage_job_runs (
  job_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  idempotency_key         TEXT NOT NULL,
  job_type                TEXT NOT NULL CHECK (job_type IN (
                            'archive_export', 'archive_verify', 'media_backfill',
                            'r2_reconcile', 'analytics_refresh', 'restore_test', 'object_delete'
                          )),
  archive_id              UUID,
  status                  TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'succeeded', 'retryable_failure',
                                            'permanent_failure', 'cancelled')),
  attempts                INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  input_rows              BIGINT CHECK (input_rows IS NULL OR input_rows >= 0),
  output_rows             BIGINT CHECK (output_rows IS NULL OR output_rows >= 0),
  bytes_processed         BIGINT CHECK (bytes_processed IS NULL OR bytes_processed >= 0),
  started_at              TIMESTAMPTZ,
  finished_at             TIMESTAMPTZ,
  next_attempt_at         TIMESTAMPTZ,
  error_code              TEXT,
  error_summary           TEXT CHECK (error_summary IS NULL OR length(error_summary) <= 1000),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT storage_job_manifest_tenant_fk
    FOREIGN KEY (tenant_id, archive_id)
    REFERENCES public.storage_archive_manifest (tenant_id, archive_id)
    ON DELETE RESTRICT,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_storage_job_queue
  ON public.storage_job_runs (status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'retryable_failure');
CREATE INDEX IF NOT EXISTS idx_storage_job_tenant_recent
  ON public.storage_job_runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.analytics_ingest_watermarks (
  tenant_id               UUID NOT NULL,
  stream_key              TEXT NOT NULL,
  source_relation         TEXT NOT NULL,
  source_watermark_at     TIMESTAMPTZ,
  source_watermark_id     TEXT,
  calculation_version     TEXT NOT NULL,
  last_batch_id           UUID,
  last_batch_row_count    BIGINT NOT NULL DEFAULT 0 CHECK (last_batch_row_count >= 0),
  completeness            TEXT NOT NULL DEFAULT 'unavailable'
                          CHECK (completeness IN ('complete', 'partial', 'stale', 'unavailable')),
  last_error_code         TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, stream_key)
);

CREATE TABLE IF NOT EXISTS public.telemetry_daily_rollups (
  tenant_id               UUID NOT NULL,
  metric_date             DATE NOT NULL,
  metric_key              TEXT NOT NULL,
  metric_version          TEXT NOT NULL,
  metric_value            NUMERIC,
  sample_count            BIGINT NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  source_watermark_at     TIMESTAMPTZ,
  completeness            TEXT NOT NULL CHECK (completeness IN ('complete', 'partial', 'stale', 'unavailable')),
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, metric_date, metric_key, metric_version)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_rollups_tenant_date
  ON public.telemetry_daily_rollups (tenant_id, metric_date DESC);

-- Default deny-by-tenant policies. Runtime connections must set app.current_org_id
-- with transaction-local scope before querying these tables. This schema does not
-- grant application privileges or install database roles; provision those separately.
ALTER TABLE public.storage_archive_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_archive_manifest FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_archive_manifest_tenant_policy ON public.storage_archive_manifest;
CREATE POLICY storage_archive_manifest_tenant_policy ON public.storage_archive_manifest
  USING (tenant_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE public.storage_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_job_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_job_runs_tenant_policy ON public.storage_job_runs;
CREATE POLICY storage_job_runs_tenant_policy ON public.storage_job_runs
  USING (tenant_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE public.analytics_ingest_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_ingest_watermarks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytics_ingest_watermarks_tenant_policy ON public.analytics_ingest_watermarks;
CREATE POLICY analytics_ingest_watermarks_tenant_policy ON public.analytics_ingest_watermarks
  USING (tenant_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE public.telemetry_daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_daily_rollups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telemetry_daily_rollups_tenant_policy ON public.telemetry_daily_rollups;
CREATE POLICY telemetry_daily_rollups_tenant_policy ON public.telemetry_daily_rollups
  USING (tenant_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

COMMIT;
