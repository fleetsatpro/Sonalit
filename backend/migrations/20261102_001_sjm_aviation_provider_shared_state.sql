-- Shared, non-tenant aviation-provider cache and quota state for SJM.
-- Aircraft observations are provider-public data. The request/event rows hold
-- no traveller or journey identifiers; one shared budget protects the single
-- FlyItaly product key across all authenticated organisations and API replicas.
BEGIN;

CREATE TABLE IF NOT EXISTS public.sjm_provider_cache (
  cache_key TEXT PRIMARY KEY CHECK (length(cache_key) BETWEEN 1 AND 512),
  cache_value TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sjm_provider_cache_expiry
  ON public.sjm_provider_cache (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sjm_provider_rate_events (
  scope_key TEXT NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 512),
  request_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope_key, request_id)
);

CREATE INDEX IF NOT EXISTS idx_sjm_provider_rate_events_scope_time
  ON public.sjm_provider_rate_events (scope_key, occurred_at DESC);

COMMENT ON TABLE public.sjm_provider_cache IS
  'Shared cache/lock/counter state for SJM external provider integrations; contains no tenant or traveller records.';
COMMENT ON TABLE public.sjm_provider_rate_events IS
  'Short-lived shared provider quota events; request identifiers are random UUIDs and are not linked to users or journeys.';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.sjm_provider_cache, public.sjm_provider_rate_events
  TO sonalit_app;

ALTER TABLE public.sjm_provider_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sjm_provider_cache FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sjm_provider_shared_access ON public.sjm_provider_cache;
CREATE POLICY sjm_provider_shared_access
  ON public.sjm_provider_cache
  FOR ALL TO sonalit_app
  USING (NULLIF(current_setting('app.current_org_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.current_org_id', true), '') IS NOT NULL);

ALTER TABLE public.sjm_provider_rate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sjm_provider_rate_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sjm_provider_shared_access ON public.sjm_provider_rate_events;
CREATE POLICY sjm_provider_shared_access
  ON public.sjm_provider_rate_events
  FOR ALL TO sonalit_app
  USING (NULLIF(current_setting('app.current_org_id', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.current_org_id', true), '') IS NOT NULL);

COMMIT;
