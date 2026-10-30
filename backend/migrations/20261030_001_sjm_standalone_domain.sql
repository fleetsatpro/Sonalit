-- SJM becomes an independent protective-mobility domain.
-- Preserve legacy convoy context, migrate usable assets directly to journeys,
-- and remove the active convoy dependency only after migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.sjm_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  email TEXT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  company TEXT,
  phone TEXT,
  account_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, email)
);

INSERT INTO public.sjm_clients (id,org_id,email,name,company,created_at,updated_at,deleted_at)
SELECT id,org_id,email,name,company,created_at,COALESCE(created_at,NOW()),deleted_at
FROM public.cargo_clients
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sjm_journeys DROP CONSTRAINT IF EXISTS sjm_journeys_client_id_fkey;
ALTER TABLE public.sjm_journeys
  ADD CONSTRAINT sjm_journeys_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.sjm_clients(id) ON DELETE SET NULL;
ALTER TABLE public.sjm_client_profiles DROP CONSTRAINT IF EXISTS sjm_client_profiles_client_id_fkey;
ALTER TABLE public.sjm_client_profiles
  ADD CONSTRAINT sjm_client_profiles_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.sjm_clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sjm_clients_org_name
  ON public.sjm_clients(org_id,lower(name)) WHERE deleted_at IS NULL;
ALTER TABLE public.sjm_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sjm_clients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sjm_org_isolation ON public.sjm_clients;
CREATE POLICY sjm_org_isolation ON public.sjm_clients
  USING (org_id=current_setting('app.current_org_id',true)::uuid)
  WITH CHECK (org_id=current_setting('app.current_org_id',true)::uuid);
DROP POLICY IF EXISTS tenant_isolation_hardening ON public.sjm_clients;
CREATE POLICY tenant_isolation_hardening ON public.sjm_clients AS RESTRICTIVE FOR ALL
  USING (org_id::text=NULLIF(current_setting('app.current_org_id',true),''))
  WITH CHECK (org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sjm_clients TO sonalit_app;

CREATE TABLE IF NOT EXISTS public.sjm_journey_legacy_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL REFERENCES public.sjm_journeys(id) ON DELETE CASCADE,
  legacy_type TEXT NOT NULL CHECK (legacy_type IN ('convoy')),
  legacy_id UUID NOT NULL,
  legacy_label TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id,journey_id,legacy_type,legacy_id)
);
CREATE INDEX IF NOT EXISTS idx_sjm_legacy_links_journey
  ON public.sjm_journey_legacy_links(org_id,journey_id,migrated_at DESC);
ALTER TABLE public.sjm_journey_legacy_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sjm_journey_legacy_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sjm_org_isolation ON public.sjm_journey_legacy_links;
CREATE POLICY sjm_org_isolation ON public.sjm_journey_legacy_links
  USING (org_id=current_setting('app.current_org_id',true)::uuid)
  WITH CHECK (org_id=current_setting('app.current_org_id',true)::uuid);
DROP POLICY IF EXISTS tenant_isolation_hardening ON public.sjm_journey_legacy_links;
CREATE POLICY tenant_isolation_hardening ON public.sjm_journey_legacy_links AS RESTRICTIVE FOR ALL
  USING (org_id::text=NULLIF(current_setting('app.current_org_id',true),''))
  WITH CHECK (org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
GRANT SELECT,INSERT ON public.sjm_journey_legacy_links TO sonalit_app;

CREATE TABLE IF NOT EXISTS public.sjm_journey_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journey_id UUID NOT NULL REFERENCES public.sjm_journeys(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('vehicle','guardian_device')),
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  guardian_device_id UUID REFERENCES public.guardian_devices(id) ON DELETE RESTRICT,
  assignment_role TEXT NOT NULL DEFAULT 'assigned' CHECK (length(trim(assignment_role)) BETWEEN 1 AND 48),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 999),
  assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  CHECK (
    (asset_type='vehicle' AND vehicle_id IS NOT NULL AND guardian_device_id IS NULL) OR
    (asset_type='guardian_device' AND guardian_device_id IS NOT NULL AND vehicle_id IS NULL)
  ),
  CHECK (removed_at IS NULL OR removed_at>=assigned_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sjm_active_vehicle_per_journey
  ON public.sjm_journey_assets(org_id,journey_id,vehicle_id)
  WHERE removed_at IS NULL AND asset_type='vehicle' AND vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sjm_active_device_per_journey
  ON public.sjm_journey_assets(org_id,journey_id,guardian_device_id)
  WHERE removed_at IS NULL AND asset_type='guardian_device' AND guardian_device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_assets_journey_active
  ON public.sjm_journey_assets(org_id,journey_id,asset_type,sort_order)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_assets_vehicle_active
  ON public.sjm_journey_assets(org_id,vehicle_id,journey_id)
  WHERE removed_at IS NULL AND vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sjm_assets_device_active
  ON public.sjm_journey_assets(org_id,guardian_device_id,journey_id)
  WHERE removed_at IS NULL AND guardian_device_id IS NOT NULL;
ALTER TABLE public.sjm_journey_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sjm_journey_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sjm_org_isolation ON public.sjm_journey_assets;
CREATE POLICY sjm_org_isolation ON public.sjm_journey_assets
  USING (org_id=current_setting('app.current_org_id',true)::uuid)
  WITH CHECK (org_id=current_setting('app.current_org_id',true)::uuid);
DROP POLICY IF EXISTS tenant_isolation_hardening ON public.sjm_journey_assets;
CREATE POLICY tenant_isolation_hardening ON public.sjm_journey_assets AS RESTRICTIVE FOR ALL
  USING (org_id::text=NULLIF(current_setting('app.current_org_id',true),''))
  WITH CHECK (org_id::text=NULLIF(current_setting('app.current_org_id',true),''));
GRANT SELECT,INSERT,UPDATE ON public.sjm_journey_assets TO sonalit_app;

-- Preserve the prior convoy association as historical context only.
INSERT INTO public.sjm_journey_legacy_links (org_id,journey_id,legacy_type,legacy_id,legacy_label,snapshot)
SELECT j.org_id,j.id,'convoy',c.id,c.name,
       jsonb_build_object('name',c.name,'status',c.status,'route_origin',c.route_origin,
                          'route_destination',c.route_destination,'migrated_from','sjm_journeys.convoy_id')
FROM public.sjm_journeys j
JOIN public.convoys c ON c.id=j.convoy_id AND c.org_id=j.org_id
WHERE j.convoy_id IS NOT NULL
ON CONFLICT (org_id,journey_id,legacy_type,legacy_id) DO NOTHING;

-- Copy existing convoy vehicle assignments onto the affected SJM journeys.
INSERT INTO public.sjm_journey_assets
  (org_id,journey_id,asset_type,vehicle_id,assignment_role,sort_order,assigned_at)
SELECT j.org_id,j.id,'vehicle',v.id,COALESCE(NULLIF(ca.role,''),'assigned'),
       ROW_NUMBER() OVER (PARTITION BY j.id ORDER BY ca.joined_at,v.id)-1,
       COALESCE(ca.joined_at,NOW())
FROM public.sjm_journeys j
JOIN public.convoy_assignments ca ON ca.convoy_id=j.convoy_id
JOIN public.vehicles v ON v.id=ca.vehicle_id AND v.org_id=j.org_id AND v.deleted_at IS NULL
WHERE j.convoy_id IS NOT NULL AND j.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.sjm_journey_assets a
    WHERE a.org_id=j.org_id AND a.journey_id=j.id
      AND a.asset_type='vehicle' AND a.vehicle_id=v.id AND a.removed_at IS NULL
  );

-- Migrate only same-tenant Guardian devices. An unowned device is accepted only
-- where a same-tenant field-officer assignment independently proves ownership.
INSERT INTO public.sjm_journey_assets
  (org_id,journey_id,asset_type,guardian_device_id,assignment_role,sort_order,assigned_at)
SELECT j.org_id,j.id,'guardian_device',d.id,'field_device',
       ROW_NUMBER() OVER (PARTITION BY j.id ORDER BY d.name,d.id)-1,NOW()
FROM public.sjm_journeys j
JOIN public.convoy_cfos cc ON cc.convoy_id=j.convoy_id AND cc.org_id=j.org_id
JOIN public.guardian_devices d ON d.id=cc.guardian_device_id AND d.deleted_at IS NULL
WHERE j.convoy_id IS NOT NULL AND j.deleted_at IS NULL
  AND (d.org_id=j.org_id OR (d.org_id IS NULL AND EXISTS (
    SELECT 1 FROM public.field_officers fo WHERE fo.device_id=d.id AND fo.org_id=j.org_id
  )))
  AND NOT EXISTS (
    SELECT 1 FROM public.sjm_journey_assets a
    WHERE a.org_id=j.org_id AND a.journey_id=j.id
      AND a.asset_type='guardian_device' AND a.guardian_device_id=d.id AND a.removed_at IS NULL
  );

ALTER TABLE public.sjm_journeys DROP CONSTRAINT IF EXISTS sjm_journeys_convoy_id_fkey;
ALTER TABLE public.sjm_journeys DROP COLUMN IF EXISTS convoy_id;

COMMIT;
