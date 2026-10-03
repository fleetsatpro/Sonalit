import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Camera,
  Car,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Focus,
  Globe2,
  Layers3,
  Maximize2,
  Minimize2,
  Orbit,
  RadioTower,
  Satellite,
  Ship,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { imageryAiBadge, imageryAiSupported } from '../lib/imageryAi.js'
import { fetchWorldContext, spatialEntityLayer, WORLD_CONTEXT_LAYERS, worldContextEntities } from '../lib/spatialClient.js'
import type { WorldContextLayer } from '../lib/spatialClient.js'
import { useLiveFleet } from '../features/live-fleet/hooks/useLiveFleet.js'
import FleetMap from '../features/live-fleet/components/FleetMap.js'
import CorridorGlobe from '../components/geofences/CorridorGlobe.js'
import CctvViewerPanel from '../components/geofences/CctvViewerPanel.js'
import type { GlobeMember, RiskZone } from '../components/geofences/CorridorWorldScene.js'
import type { LiveVehicle } from '../features/live-fleet/types/fleet.js'
import '../styles/gev-command.css'

type View = '2D' | '3D'

const layerMeta: Record<WorldContextLayer, { short: string; label: string; icon: typeof Globe2 }> = {
  aircraft: { short: 'AIR', label: 'Aircraft', icon: Activity },
  weather: { short: 'WX', label: 'Weather', icon: CloudSun },
  maritime: { short: 'SEA', label: 'Maritime', icon: Ship },
  traffic: { short: 'TRF', label: 'Traffic', icon: Car },
  hazards: { short: 'HAZ', label: 'Hazards', icon: TriangleAlert },
  security: { short: 'SEC', label: 'Security', icon: ShieldCheck },
  infrastructure: { short: 'INF', label: 'Infrastructure', icon: Layers3 },
  incidents: { short: 'INC', label: 'Incidents', icon: TriangleAlert },
  alerts: { short: 'ALT', label: 'Alerts', icon: RadioTower },
  cameras: { short: 'CAM', label: 'Cameras', icon: Camera },
  satellites: { short: 'ORB', label: 'Satellites', icon: Satellite },
}

function toGlobeMember(v: LiveVehicle): GlobeMember {
  return {
    id: v.id,
    name: v.registration,
    officer_name: v.officer_name,
    lat: v.lat,
    lng: v.lng,
    status: v.status === 'move' ? 'on_track' : v.status === 'sos' ? 'off_route' : v.status,
    heading: v.heading,
    speed_kph: v.speed_kmh,
    position_state: v.secondsAgo > 1800 ? 'stale' : v.lat == null ? 'no_fix' : 'observed',
    position_confidence: v.lat == null ? 0 : v.secondsAgo > 1800 ? 0.5 : 1,
    position_uncertainty_m: v.lat == null ? 9999 : v.secondsAgo > 1800 ? 500 : 25,
    vehicle_type: v.kind === 'guardian' ? 'guardian' : 'vehicle',
  }
}

function formatUtcClock(date: Date) {
  return date.toISOString().slice(11, 19) + 'Z'
}

export default function GodsEyeView() {
  const navigate = useNavigate()
  const { groups, counts } = useLiveFleet()
  const [view, setView] = useState<View>('3D')
  const [selected, setSelected] = useState<LiveVehicle | null>(null)
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(null)
  const [visibleLayers, setVisibleLayers] = useState<Set<WorldContextLayer>>(() => new Set(WORLD_CONTEXT_LAYERS))
  const [overviewOpen, setOverviewOpen] = useState(true)
  const [intelligenceOpen, setIntelligenceOpen] = useState(true)
  const [layersOpen, setLayersOpen] = useState(true)
  const [externalVisible, setExternalVisible] = useState(true)
  const [cctvOpen, setCctvOpen] = useState(false)
  const [clock, setClock] = useState(() => new Date())

  const chromeExpanded = overviewOpen || intelligenceOpen
  const toggleAllChrome = () => {
    const nextOpen = !chromeExpanded
    setOverviewOpen(nextOpen)
    setIntelligenceOpen(nextOpen)
  }

  const setViewMode = (nextView: View) => {
    setView(nextView)
    if (nextView === '2D') {
      setSelectedExternalId(null)
      setCctvOpen(false)
    }
  }

  const openCctv = () => {
    setView('3D')
    setCctvOpen(true)
    setExternalVisible(true)
    setVisibleLayers(current => current.has('cameras') ? current : new Set([...current, 'cameras']))
    setOverviewOpen(false)
    setIntelligenceOpen(false)
  }

  const toggleCctv = () => {
    if (cctvOpen) {
      setCctvOpen(false)
      return
    }
    openCctv()
  }

  const toggleExternal = () => {
    const nextVisible = !externalVisible
    setExternalVisible(nextVisible)
    if (!nextVisible) setSelectedExternalId(null)
  }

  const allVehicles = useMemo(() => groups.flatMap(g => g.vehicles), [groups])
  const members = useMemo(() => allVehicles.map(toGlobeMember), [allVehicles])
  const initialWorldCenter = useMemo(() => {
    const positioned = allVehicles.filter(v => v.lat != null && v.lng != null)
    if (!positioned.length) return { latitude: 35.5, longitude: 1.2 }
    const total = positioned.reduce(
      (sum, v) => ({ latitude: sum.latitude + Number(v.lat), longitude: sum.longitude + Number(v.lng) }),
      { latitude: 0, longitude: 0 },
    )
    return { latitude: total.latitude / positioned.length, longitude: total.longitude / positioned.length }
  }, [allVehicles])

  const [worldViewport, setWorldViewport] = useState({ ...initialWorldCenter, radiusM: 100000 })
  const worldViewportRef = useRef(worldViewport)
  const worldViewportSeededRef = useRef(false)
  worldViewportRef.current = worldViewport
  const positionedVehicles = useMemo(() => allVehicles.filter(v => v.lat != null && v.lng != null), [allVehicles])

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const { data: worldContext, isFetching: worldFetching, isError: worldError } = useQuery({
    queryKey: ['gev-3d-world-context', worldViewport.latitude, worldViewport.longitude, worldViewport.radiusM],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchWorldContext({
      center: { latitude: worldViewport.latitude, longitude: worldViewport.longitude },
      radiusM: Math.min(100000, worldViewport.radiusM),
      layers: [...WORLD_CONTEXT_LAYERS],
      maxEntitiesPerLayer: 30,
      signal,
    }),
    enabled: view === '3D',
    staleTime: 15000,
    refetchInterval: 30000,
    retry: 1,
  })

  const externalEntities = useMemo(
    () => worldContextEntities(worldContext).filter(entity => !['vehicle', 'guardian_device'].includes(entity.entityType)),
    [worldContext],
  )

  const { data: cctvResult, isFetching: cctvFetching, isError: cctvError } = useQuery<{
    data: SpatialWorldEntity[]
    health?: { recordCount?: number; acceptedCount?: number; status?: string }
    coverage?: { complete?: boolean; bounded?: boolean; queryScope?: string; providers?: Record<string, { status?: string; recordCount?: number; total?: number | null; free?: number | null }> }
    warnings?: string[]
  }>({
    queryKey: ['gev-cctv-catalog', worldViewport.latitude, worldViewport.longitude, worldViewport.radiusM],
    queryFn: async () => {
      const response = await api.get<{
        data: SpatialWorldEntity[]
        health?: { recordCount?: number; acceptedCount?: number; status?: string }
        coverage?: { complete?: boolean; bounded?: boolean; queryScope?: string; providers?: Record<string, { status?: string; recordCount?: number; total?: number | null; free?: number | null }> }
        warnings?: string[]
      }>('/cctv/cameras', {
        params: {
          lat: worldViewport.latitude,
          lng: worldViewport.longitude,
          radiusM: Math.min(100000, worldViewport.radiusM),
          limit: 120,
        },
      })
      return response.data
    },
    enabled: view === '3D' && cctvOpen,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const cctvCatalog = cctvResult?.data ?? []
  const cctvCoverage = cctvResult?.coverage
  const cctvPublicTotal = cctvCoverage?.providers?.openeye?.free ?? cctvCoverage?.providers?.openeye?.total ?? cctvCatalog.length

  const cctvEntities = useMemo(
    () => cctvCatalog.filter(entity => Number.isFinite(entity.latitude) && Number.isFinite(entity.longitude)),
    [cctvCatalog],
  )

  const allExternalEntities = useMemo(() => {
    if (!cctvOpen) return externalEntities
    const byId = new Map<string, SpatialWorldEntity>()
    for (const entity of externalEntities) byId.set(entity.id, entity)
    for (const entity of cctvEntities) byId.set(entity.id, entity)
    return Array.from(byId.values())
  }, [externalEntities, cctvEntities, cctvOpen])
  const renderableExternalEntities = useMemo(() => {
    if (!externalVisible) return []
    const filtered = allExternalEntities.filter(entity => {
      if (!Number.isFinite(entity.latitude) || !Number.isFinite(entity.longitude)) return false
      const layer = spatialEntityLayer(entity)
      return layer ? visibleLayers.has(layer) : false
    })
    const MAX_RENDER_MARKERS = 180
    if (filtered.length <= MAX_RENDER_MARKERS) return filtered
    const selectedEntity = selectedExternalId ? filtered.find(entity => entity.id === selectedExternalId) : null
    const cameras = filtered.filter(entity => entity.entityType === 'camera' || entity.entityType === 'spatial_camera')
    const priorityLayers: WorldContextLayer[] = ['hazards', 'alerts', 'security', 'incidents', 'traffic', 'aircraft', 'maritime', 'satellites', 'infrastructure', 'weather']
    const ordered = [
      ...(selectedEntity ? [selectedEntity] : []),
      ...cameras,
      ...priorityLayers.flatMap(layer => filtered.filter(entity => spatialEntityLayer(entity) === layer)),
    ]
    const seen = new Set<string>()
    return ordered.filter(entity => {
      if (seen.has(entity.id)) return false
      seen.add(entity.id)
      return true
    }).slice(0, MAX_RENDER_MARKERS)
  }, [allExternalEntities, visibleLayers, externalVisible, selectedExternalId])

  useEffect(() => {
    if (view !== '3D' || positionedVehicles.length === 0 || worldViewportSeededRef.current) return
    worldViewportSeededRef.current = true
    setWorldViewport({ ...initialWorldCenter, radiusM: 100000 })
  }, [view, positionedVehicles.length, initialWorldCenter])

  const layerCounts = useMemo(() => {
    const result = Object.fromEntries(WORLD_CONTEXT_LAYERS.map(layer => [layer, 0])) as Record<WorldContextLayer, number>
    for (const entity of externalEntities) {
      const layer = spatialEntityLayer(entity)
      if (layer) result[layer] += 1
    }
    return result
  }, [externalEntities])

  const selectedExternal = useMemo(
    () => allExternalEntities.find(entity => entity.id === selectedExternalId) ?? null,
    [allExternalEntities, selectedExternalId],
  )

  const { data: zones = [] } = useQuery<RiskZone[]>({
    queryKey: ['gev-riskzones'],
    queryFn: async () => {
      const r = await api.get<{ data: Array<{ h3_index: string; name: string; risk_level: string; center_lat: number; center_lon: number; radius_km: number }> }>('/riskzones')
      return (r.data.data ?? []).map(z => ({
        zone_id: z.h3_index,
        name: z.name,
        risk_level: z.risk_level,
        lat: z.center_lat,
        lng: z.center_lon,
        radius_km: z.radius_km,
      }))
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const syncState = worldError ? 'degraded' : worldFetching ? 'sync' : 'live'
  const topEntities = useMemo(() => renderableExternalEntities.slice(0, 10), [renderableExternalEntities])

  return (
    <div
      className="gev-shell"
      data-overview-collapsed={!overviewOpen}
      data-intelligence-collapsed={!intelligenceOpen}
    >
      <header className="gev-topbar">
        <div className="gev-brand">
          <button type="button" className="gev-exit" onClick={() => void navigate({ to: '/command' })} aria-label="Return to Command Centre" title="Return to Command Centre">
            <ChevronLeft size={15} />
            <span>COMMAND</span>
          </button>
          <div className="gev-brand-mark" aria-hidden="true"><Globe2 size={18} /></div>
          <div className="gev-brand-copy">
            <div className="gev-kicker">SONALIT · SPATIAL COMMAND</div>
            <div className="gev-title">GOD'S EYE VIEW</div>
            <div className="gev-subtitle">Global spatial picture · operational authority · provenance visible</div>
          </div>
        </div>

        <div className="gev-topcenter" role="group" aria-label="View mode">
          <button type="button" className="gev-segment" aria-pressed={view === '2D'} onClick={() => setViewMode('2D')}>
            <Layers3 size={13} /> World 2D
          </button>
          <button type="button" className="gev-segment" aria-pressed={view === '3D'} onClick={() => setViewMode('3D')}>
            <Orbit size={13} /> Immersive 3D
          </button>
          <button type="button" className="gev-cctv-trigger" aria-pressed={cctvOpen} onClick={toggleCctv} title="Open CCTV camera viewer">
            <Camera size={13} /> CCTV <span>{cctvEntities.length || layerCounts.cameras || '—'}</span>
          </button>
        </div>

        <div className="gev-topright">
          <div className="gev-ai-badge" title="Open-source Real-ESRGAN enhancement is applied to deep-zoom photographic imagery when the device can run it safely. Source imagery remains authoritative.">
            <span className="gev-ai-badge-dot" />
            {imageryAiSupported() ? imageryAiBadge() : 'SOURCE IMAGE'}
          </div>
          <div className="gev-health">
            <span className="gev-health-dot" />
            <span className="gev-health-label">Operational link</span>
          </div>
          <div className="gev-clock" aria-label="UTC time">
            <span>UTC {formatUtcClock(clock)}</span>
            <span>{worldViewport.latitude.toFixed(3)}° · {worldViewport.longitude.toFixed(3)}°</span>
          </div>
        </div>
      </header>

      <main className="gev-workspace">
        <section className="gev-stage" aria-label="Sonalit God’s Eye View map">
          {view === '2D' ? (
            <FleetMap
              vehicles={allVehicles}
              selectedId={selected?.id ?? null}
              onSelect={vehicle => { setSelected(vehicle); setSelectedExternalId(null) }}
            />
          ) : (
            <CorridorGlobe
              route={[]}
              corridorKm={1}
              members={members}
              zones={zones}
              focusId={selected?.id ?? null}
              fill
              surface="gev"
              fixedView="3D"
              showChrome={false}
              showMapControls
              worldEntities={renderableExternalEntities}
              selectedExternalId={selectedExternalId}
              onExternalSelect={id => { setSelectedExternalId(id); setSelected(null) }}
              onSelect={id => { setSelectedExternalId(null); setSelected(id ? allVehicles.find(v => v.id === id) ?? null : null) }}
              onViewportChange={setWorldViewport}
            />
          )}
        </section>

        <div className="gev-chrome">
          <aside className="gev-left-rail" data-open={layersOpen} aria-label="World context layers">
            <div className="gev-rail">
              <div className="gev-rail-head">
                <span className="gev-rail-title">LAYERS</span>
                <button type="button" className="gev-rail-toggle" onClick={() => setLayersOpen(open => !open)} aria-expanded={layersOpen} aria-label={layersOpen ? 'Collapse world context layers' : 'Expand world context layers'} title={layersOpen ? 'Collapse layers' : 'Expand layers'}>
                  {layersOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
                </button>
              </div>
              <div className="gev-layer-label">{view}</div>
              {layersOpen && WORLD_CONTEXT_LAYERS.map(layer => {
                const meta = layerMeta[layer]
                const Icon = meta.icon
                return (
                  <button
                    key={layer}
                    type="button"
                    className="gev-rail-button"
                    title={view === '3D' ? `${meta.label} · ${visibleLayers.has(layer) ? 'visible' : 'hidden'}` : `${meta.label} · 3D only`}
                    aria-label={meta.label}
                    aria-pressed={view === '3D' && visibleLayers.has(layer)}
                    aria-disabled={view !== '3D'}
                    disabled={view !== '3D'}
                    onClick={() => {
                      if (layer === 'cameras') {
                        openCctv()
                        return
                      }
                      setVisibleLayers(current => {
                        const next = new Set(current)
                        if (next.has(layer)) {
                          next.delete(layer)
                          if (selectedExternal && spatialEntityLayer(selectedExternal) === layer) setSelectedExternalId(null)
                        } else {
                          next.add(layer)
                        }
                        return next
                      })
                    }}
                  >
                    <Icon size={15} />
                    <span className="gev-rail-tag">{layerCounts[layer] > 99 ? '99+' : layerCounts[layer]}</span>
                  </button>
                )
              })}
              {layersOpen && (
                <div className="gev-rail-actions">
                  <button type="button" onClick={() => setVisibleLayers(new Set(WORLD_CONTEXT_LAYERS))}>ALL</button>
                  <button type="button" onClick={() => setVisibleLayers(new Set())}>NONE</button>
                  <button type="button" aria-pressed={externalVisible} onClick={toggleExternal}>{externalVisible ? 'WORLD' : 'HIDDEN'}</button>
                </div>
              )}
            </div>
            <div className="gev-status-orbit" title={worldError ? 'World context degraded' : 'World context available'}><span /></div>
          </aside>

          {cctvOpen && view === '3D' && (
            <CctvViewerPanel
              cameras={cctvEntities}
              selectedCameraId={selectedExternal?.entityType === 'camera' || selectedExternal?.entityType === 'spatial_camera' ? selectedExternal.id : null}
              loading={cctvFetching}
              error={cctvError}
              onSelectCamera={id => setSelectedExternalId(id)}
              onClose={() => setCctvOpen(false)}
            />
          )}

          <section
            className="gev-panel gev-overview-panel"
            data-collapsed={!overviewOpen}
            aria-label="World picture overview"
          >
            <div className="gev-panel-head">
              <div className="gev-panel-heading-copy">
                <div className="gev-panel-eyebrow">World picture</div>
                <div className="gev-panel-title">{view === '3D' ? 'Immersive spatial fabric' : 'Operational world canvas'}</div>
                <div className="gev-panel-meta">11 intelligence layers · external provenance retained · local telemetry remains authoritative</div>
              </div>
              <div className="gev-panel-head-actions">
                <div className="gev-signal" data-state={syncState}>
                  <span className="gev-signal-dot" />
                  {worldError ? 'Degraded' : worldFetching ? 'Syncing' : 'Connected'}
                </div>
                <button
                  type="button"
                  className="gev-panel-toggle"
                  onClick={() => setOverviewOpen(open => !open)}
                  aria-expanded={overviewOpen}
                  aria-controls="gev-world-picture-content"
                  aria-label={overviewOpen ? 'Collapse world picture' : 'Expand world picture'}
                  title={overviewOpen ? 'Collapse world picture' : 'Expand world picture'}
                >
                  {overviewOpen ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
                </button>
              </div>
            </div>

            <div className="gev-panel-content" id="gev-world-picture-content" hidden={!overviewOpen}>
              <div className="gev-stat-grid">
                <div className="gev-stat"><span className="gev-stat-label">Entities</span><span className="gev-stat-value">{counts.all}</span></div>
                <div className="gev-stat"><span className="gev-stat-label">Positioned</span><span className="gev-stat-value" data-tone="green">{positionedVehicles.length}</span></div>
                <div className="gev-stat"><span className="gev-stat-label">External</span><span className="gev-stat-value" data-tone="violet">{renderableExternalEntities.length}</span></div>
                <div className="gev-stat"><span className="gev-stat-label">Risk zones</span><span className="gev-stat-value" data-tone="amber">{zones.length}</span></div>
              </div>

              <div className="gev-layer-grid">
                {WORLD_CONTEXT_LAYERS.map(layer => (
                  <div className="gev-layer" key={layer} title={layerMeta[layer].label}>
                    <span>{layerMeta[layer].short}</span><span>{layerCounts[layer]}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside
            className="gev-panel gev-right-panel"
            data-collapsed={!intelligenceOpen}
            aria-label="Entity intelligence"
          >
            <div className="gev-panel-head">
              <div className="gev-panel-heading-copy">
                <div className="gev-panel-eyebrow">Entity intelligence</div>
                <div className="gev-panel-title">{selectedExternal?.entityType === 'camera' || selectedExternal?.entityType === 'spatial_camera' ? 'Selected CCTV camera' : selectedExternal ? 'Selected external signal' : selected ? 'Selected operational entity' : 'World signal index'}</div>
                <div className="gev-panel-meta">{view === '3D' ? 'Pick a signal on the globe to inspect provenance and freshness.' : 'Select a vehicle to inspect live operational state.'}</div>
              </div>
              <div className="gev-panel-head-actions">
                {(selectedExternal || selected) && (
                  <button type="button" className="gev-close" onClick={() => { setSelectedExternalId(null); setSelected(null) }} aria-label="Close selection" title="Clear selection"><X size={14} /></button>
                )}
                <button
                  type="button"
                  className="gev-panel-toggle"
                  onClick={() => setIntelligenceOpen(open => !open)}
                  aria-expanded={intelligenceOpen}
                  aria-controls="gev-entity-intelligence-content"
                  aria-label={intelligenceOpen ? 'Collapse entity intelligence' : 'Expand entity intelligence'}
                  title={intelligenceOpen ? 'Collapse entity intelligence' : 'Expand entity intelligence'}
                >
                  {intelligenceOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                </button>
              </div>
            </div>

            <div className="gev-right-body" id="gev-entity-intelligence-content" hidden={!intelligenceOpen}>
              {selectedExternal ? (
                <div className="gev-entity-hero">
                  <div className="gev-entity-kicker">External entity</div>
                  <div className="gev-entity-title">{String(selectedExternal.attributes?.callsign ?? selectedExternal.attributes?.name ?? selectedExternal.attributes?.title ?? selectedExternal.id)}</div>
                  <div className="gev-entity-sub">{String(spatialEntityLayer(selectedExternal)?.toUpperCase() ?? selectedExternal.entityType.toUpperCase())} · {String(selectedExternal.source ?? 'UNKNOWN SOURCE')}</div>
                  <div className="gev-mini-grid">
                    <div className="gev-mini"><div className="gev-mini-label">Freshness</div><span className="gev-mini-value">{selectedExternal.quality?.freshnessClass ?? 'UNKNOWN'}</span></div>
                    <div className="gev-mini"><div className="gev-mini-label">Altitude</div><span className="gev-mini-value">{selectedExternal.altitudeM != null ? Math.round(selectedExternal.altitudeM / 10) * 10 + ' m' : 'GROUND'}</span></div>
                    <div className="gev-mini"><div className="gev-mini-label">Confidence</div><span className="gev-mini-value">{selectedExternal.observationConfidence != null ? Math.round(selectedExternal.observationConfidence * 100) + '%' : '—'}</span></div>
                  </div>
                  <div className="gev-detail-callout" style={{ marginTop: 9, border: '1px solid rgba(184,166,255,.10)', borderRadius: 10 }}>
                    <div className="gev-detail-label">{selectedExternal.entityType === 'satellite' ? 'Modelled orbital position' : selectedExternal.entityType === 'spatial_camera' || selectedExternal.entityType === 'camera' ? 'Camera observation' : selectedExternal.telemetryLive === true ? 'Live external telemetry' : 'External observation'}</div>
                    <div className="gev-detail-note">{selectedExternal.entityType === 'satellite' ? 'Not live telemetry · not an imaging or tasking claim.' : selectedExternal.entityType === 'spatial_camera' || selectedExternal.entityType === 'camera' ? 'Geometry indicates possible visibility only. Approved camera media is opened in the CCTV viewer.' : 'Source and quality controls remain visible to the operator.'}</div>
                    {(selectedExternal.entityType === 'camera' || selectedExternal.entityType === 'spatial_camera') && (
                      <button type="button" className="gev-cctv-inline-action" onClick={openCctv}><Camera size={12} /> OPEN CCTV VIEWER</button>
                    )}
                  </div>
                </div>
              ) : selected ? (
                <div className="gev-entity-hero">
                  <div className="gev-entity-kicker">Sonalit operational entity</div>
                  <div className="gev-entity-title">{selected.registration}</div>
                  <div className="gev-entity-sub">{selected.convoy_name ?? 'Standalone'} · {selected.status.toUpperCase()}</div>
                  <div className="gev-mini-grid">
                    <div className="gev-mini"><div className="gev-mini-label">Speed</div><span className="gev-mini-value">{Math.round(selected.speed_kmh)} km/h</span></div>
                    <div className="gev-mini"><div className="gev-mini-label">Fix age</div><span className="gev-mini-value">{selected.secondsAgo < 60 ? Math.round(selected.secondsAgo) + ' s' : Math.round(selected.secondsAgo / 60) + ' m'}</span></div>
                    <div className="gev-mini"><div className="gev-mini-label">Position</div><span className="gev-mini-value">{selected.lat != null ? 'OBSERVED' : 'NO FIX'}</span></div>
                  </div>
                  <div className="gev-detail-note" style={{ marginTop: 11 }}>Sonalit operational telemetry remains the authoritative vehicle/device position. External world context is enrichment only.</div>
                </div>
              ) : (
                <>
                  <div className="gev-entity-hero">
                    <div className="gev-entity-kicker">Live index</div>
                    <div className="gev-entity-title">{renderableExternalEntities.length} signals in view</div>
                    <div className="gev-entity-sub">VIEWPORT-LINKED · PROVENANCE PRESERVED</div>
                    <div className="gev-mini-grid">
                      <div className="gev-mini"><div className="gev-mini-label">Operational</div><span className="gev-mini-value">{counts.all}</span></div>
                      <div className="gev-mini"><div className="gev-mini-label">Guardian</div><span className="gev-mini-value">{counts.officers}</span></div>
                      <div className="gev-mini"><div className="gev-mini-label">Coverage</div><span className="gev-mini-value">{WORLD_CONTEXT_LAYERS.length}/11</span></div>
                    </div>
                  </div>
                  <div className="gev-external-list">
                    {topEntities.map(entity => (
                      <button key={entity.id} type="button" className="gev-external-row" onClick={() => setSelectedExternalId(entity.id)}>
                        <span className="gev-external-mark" />
                        <span className="gev-external-copy">
                          <span className="gev-external-name">{String(entity.attributes?.callsign ?? entity.attributes?.name ?? entity.attributes?.title ?? entity.id)}</span>
                          <span className="gev-external-meta">{String(spatialEntityLayer(entity)?.replace('_', ' ') ?? entity.entityType)} · {String(entity.source ?? 'source unknown')}</span>
                        </span>
                        <span className="gev-external-value">{entity.quality?.freshnessClass ?? '—'}</span>
                      </button>
                    ))}
                    {!topEntities.length && <div className="gev-detail-note">No external entities are currently renderable in this viewport.</div>}
                  </div>
                </>
              )}
            </div>

            <div className="gev-footnote">{view === '3D' ? '3D fidelity is adaptive to display density. Orbital positions are modelled; camera geometry is not visual acquisition.' : '2D is optimized for operational scanning. External observations never replace convoy state, evidence, or GPS authority.'}</div>
          </aside>

          <div className="gev-bottom-ribbon">
            <div className="gev-ribbon">
              <span className="gev-ribbon-item"><Focus size={11} /> Mode <strong>{view}</strong></span>
              <span className="gev-ribbon-sep" />
              <span className="gev-ribbon-item">Viewport <strong>{Math.round(worldViewport.radiusM / 1000)} km</strong></span>
              <span className="gev-ribbon-sep" />
              <span className="gev-ribbon-item">Signals <strong>{renderableExternalEntities.length}</strong></span>
              <span className="gev-ribbon-sep" />
              <span className="gev-ribbon-item">UTC <strong>{formatUtcClock(clock)}</strong></span>
              <span className="gev-ribbon-sep" />
              <button
                type="button"
                className="gev-ribbon-action"
                onClick={toggleAllChrome}
                aria-expanded={chromeExpanded}
                aria-label={chromeExpanded ? 'Collapse command chrome' : 'Expand command chrome'}
                title={chromeExpanded ? 'Collapse command chrome' : 'Expand command chrome'}
              >
                {chromeExpanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                <span>{chromeExpanded ? 'Focus map' : 'Show panels'}</span>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
