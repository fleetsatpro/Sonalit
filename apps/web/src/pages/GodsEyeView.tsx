import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Camera,
  Car,
  ChevronLeft,
  CloudLightning,
  ChevronRight,
  CloudSun,
  Focus,
  Globe2,
  Layers3,
  Maximize2,
  Minimize2,
  Orbit,
  Pause,
  Play,
  RadioTower,
  Satellite,
  Ship,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { imageryAiBadge, imageryAiSupported } from '../lib/imageryAi.js'
import { fetchLiveEventSimulation, fetchWorldContext, snapSpatialBounds, shouldRetrySpatialRequest, spatialEntityLayer, WORLD_CONTEXT_LAYERS, worldContextEntities } from '../lib/spatialClient.js'
import type { SpatialWorldEntity, WorldContextLayer } from '../lib/spatialClient.js'
import { useLiveFleet } from '../features/live-fleet/hooks/useLiveFleet.js'
import FleetMap from '../features/live-fleet/components/FleetMap.js'
import CorridorGlobe from '../components/geofences/CorridorGlobe.js'
import CctvViewerPanel from '../components/geofences/CctvViewerPanel.js'
import type { GlobeMember, RiskZone } from '../components/geofences/CorridorWorldScene.js'
import type { LiveVehicle } from '../features/live-fleet/types/fleet.js'
import '../styles/gev-command.css'
import '../styles/cctv-wall.css'

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

function formatForecastTime(value?: string): string | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][date.getUTCMonth()]
  return day + ' ' + month + ' · ' + date.toISOString().slice(11, 16) + ' UTC'
}

function formatForecastTick(value?: string): string | null {
  const label = formatForecastTime(value)
  return label ? label.replace(' · ', ' ').replace(' UTC', 'Z') : null
}

function safeExternalUrl(value: unknown, fallback: string): string {
  try {
    const url = new URL(String(value ?? ''))
    return url.protocol === 'https:' ? url.toString() : fallback
  } catch {
    return fallback
  }
}

export default function GodsEyeView() {
  const navigate = useNavigate()
  const { groups, counts } = useLiveFleet()
  const [view, setView] = useState<View>('3D')
  const [selected, setSelected] = useState<LiveVehicle | null>(null)
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(null)
  const [visibleLayers, setVisibleLayers] = useState<Set<WorldContextLayer>>(() => new Set(WORLD_CONTEXT_LAYERS))
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [intelligenceOpen, setIntelligenceOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(true)
  const [externalVisible, setExternalVisible] = useState(true)
  const [cctvOpen, setCctvOpen] = useState(false)
  const [mapNavigationExpanded, setMapNavigationExpanded] = useState(false)
  const [weatherAnimationEnabled, setWeatherAnimationEnabled] = useState(false)
  const [liveSimulationEnabled, setLiveSimulationEnabled] = useState(false)
  const [simulationPlaying, setSimulationPlaying] = useState(false)
  const [forecastStepIndex, setForecastStepIndex] = useState(0)
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

  const [worldViewport, setWorldViewport] = useState<{ latitude:number; longitude:number; radiusM:number; bbox?:[number,number,number,number] }>({ ...initialWorldCenter, radiusM: 100000 })
  const worldViewportRef = useRef(worldViewport)
  const worldViewportSeededRef = useRef(false)
  worldViewportRef.current = worldViewport
  // Keep the globe responsive while holding expensive weather requests until
  // camera movement settles; the weather query uses its own stable viewport.
  const [weatherQueryViewport, setWeatherQueryViewport] = useState(worldViewport)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWeatherQueryViewport(current => {
        const sameBounds = current.bbox?.join(',') === worldViewport.bbox?.join(',')
        return current.latitude === worldViewport.latitude
          && current.longitude === worldViewport.longitude
          && current.radiusM === worldViewport.radiusM
          && sameBounds ? current : worldViewport
      })
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [worldViewport])
  const weatherBounds = useMemo<[number, number, number, number]>(() => {
    let bounds: [number, number, number, number]
    if (weatherQueryViewport.bbox && weatherQueryViewport.bbox.length === 4 && weatherQueryViewport.bbox.every(Number.isFinite)
      && weatherQueryViewport.bbox[0] < weatherQueryViewport.bbox[2] && weatherQueryViewport.bbox[1] < weatherQueryViewport.bbox[3]) {
      bounds = weatherQueryViewport.bbox
    } else {
      const radius = Math.min(250000, Math.max(1000, weatherQueryViewport.radiusM || 100000))
      const latitudeDelta = radius / 111320
      const cosine = Math.max(0.087, Math.abs(Math.cos(weatherQueryViewport.latitude * Math.PI / 180)))
      const longitudeDelta = Math.min(180, radius / (111320 * cosine))
      bounds = [
        Math.max(-180, weatherQueryViewport.longitude - longitudeDelta),
        Math.max(-90, weatherQueryViewport.latitude - latitudeDelta),
        Math.min(180, weatherQueryViewport.longitude + longitudeDelta),
        Math.min(90, weatherQueryViewport.latitude + latitudeDelta),
      ]
    }
    return snapSpatialBounds(bounds)
  }, [weatherQueryViewport.latitude, weatherQueryViewport.longitude, weatherQueryViewport.radiusM, weatherQueryViewport.bbox])
  const positionedVehicles = useMemo(() => allVehicles.filter(v => v.lat != null && v.lng != null), [allVehicles])

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const { data: worldContext, isFetching: worldFetching, isError: worldError } = useQuery({
    queryKey: ['gev-3d-world-context', worldViewport.latitude, worldViewport.longitude, worldViewport.radiusM, worldViewport.bbox?.join(',')],
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

  const { data: liveSimulationResult, isFetching: liveSimulationFetching, isError: liveSimulationError } = useQuery({
    queryKey: ['gev-live-event-simulation', ...weatherBounds.map(value => Math.round(value * 100) / 100)],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchLiveEventSimulation({
      center: { latitude: weatherQueryViewport.latitude, longitude: weatherQueryViewport.longitude },
      radiusM: Math.min(250000, Math.max(1000, weatherQueryViewport.radiusM)),
      bounds: weatherBounds,
      signal,
    }),
    enabled: liveSimulationEnabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: shouldRetrySpatialRequest,
    placeholderData: previousData => previousData,
  })

  const simulationForecastSteps = useMemo(() => {
    const first = liveSimulationResult?.data.find(entity =>
      entity.entityType === 'weather' && Array.isArray(entity.attributes?.forecastSteps)
    )
    return (first?.attributes?.forecastSteps as Array<{ validAt?: string }> | undefined) ?? []
  }, [liveSimulationResult])

  const simulationWeatherEntities = useMemo(() => {
    if (!liveSimulationEnabled) return []
    return (liveSimulationResult?.data ?? [])
      .filter(entity => entity.entityType === 'weather')
      .map(entity => {
        const steps = entity.attributes?.forecastSteps as Array<Record<string, unknown>> | undefined
        const selectedStep = steps?.[Math.min(forecastStepIndex, Math.max(0, (steps?.length ?? 1) - 1))]
        if (!selectedStep) return entity
        return {
          ...entity,
          attributes: { ...entity.attributes, ...selectedStep, name: 'Weather forecast', simulationMode: 'hourly_forecast' },
        } as SpatialWorldEntity
      })
  }, [liveSimulationEnabled, liveSimulationResult, forecastStepIndex])

  const simulationNaturalEvents = useMemo(() => {
    if (!liveSimulationEnabled) return []
    const events = (liveSimulationResult?.data ?? []).filter(entity =>
      entity.entityType === 'earthquake' || entity.entityType === 'volcano' || entity.entityType === 'natural_event'
    )
    // Keep official volcano alerts/reports and a bounded set of source-backed
    // global events before earthquakes consume the map's marker budget.
    const volcanoReports = events.filter(entity => entity.entityType === 'volcano')
    const globalNaturalEvents = events.filter(entity => {
      if (entity.entityType !== 'natural_event') return false
      const categories = (entity.attributes?.categories as Array<Record<string, unknown>> | undefined) ?? []
      const names = [
        String(entity.attributes?.categoryId ?? ''),
        String(entity.attributes?.categoryTitle ?? ''),
        ...categories.flatMap(category => [String(category.id ?? ''), String(category.title ?? '')]),
      ].map(value => value.toLowerCase())
      // Dedicated USGS/Smithsonian feeds provide better volcano and earthquake records.
      return !names.some(name => name.includes('volcano') || name.includes('earthquake'))
    }).sort((a, b) => {
      const dateA = Date.parse(String(a.attributes?.eventDate ?? a.observedAt ?? '')) || 0
      const dateB = Date.parse(String(b.attributes?.eventDate ?? b.observedAt ?? '')) || 0
      return dateB - dateA
    }).slice(0, 50)
    const earthquakes = events.filter(entity => entity.entityType === 'earthquake')
      .sort((a, b) => {
        const magnitudeA = Number(a.attributes?.magnitude)
        const magnitudeB = Number(b.attributes?.magnitude)
        return (Number.isFinite(magnitudeB) ? magnitudeB : 0) - (Number.isFinite(magnitudeA) ? magnitudeA : 0)
      })
      .slice(0, 60)
    return [...volcanoReports, ...globalNaturalEvents, ...earthquakes]
  }, [liveSimulationEnabled, liveSimulationResult])

  const liveSimulationEntities = useMemo(
    () => [...simulationWeatherEntities, ...simulationNaturalEvents],
    [simulationWeatherEntities, simulationNaturalEvents],
  )

  const selectedForecastTime = simulationForecastSteps[Math.min(forecastStepIndex, Math.max(0, simulationForecastSteps.length - 1))]?.validAt

  useEffect(() => {
    if (!liveSimulationEnabled || !simulationPlaying || simulationForecastSteps.length < 2) return
    const timer = window.setInterval(() => {
      setForecastStepIndex(index => (index + 1) % simulationForecastSteps.length)
    }, 1700)
    return () => window.clearInterval(timer)
  }, [liveSimulationEnabled, simulationPlaying, simulationForecastSteps.length])

  const { data: weatherGridContext, isFetching: weatherGridFetching, isError: weatherGridError } = useQuery({
    queryKey: ['gev-weather-animation-grid', ...weatherBounds.map(value => Math.round(value * 100) / 100)],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchWorldContext({
      center: { latitude: weatherQueryViewport.latitude, longitude: weatherQueryViewport.longitude },
      radiusM: Math.min(250000, Math.max(1000, weatherQueryViewport.radiusM)),
      layers: ['weather'],
      maxEntitiesPerLayer: 36,
      weatherGrid: true,
      weatherBounds,
      signal,
    }),
    enabled: weatherAnimationEnabled,
    staleTime: 90_000,
    refetchInterval: 180_000,
    refetchOnWindowFocus: false,
    retry: shouldRetrySpatialRequest,
    placeholderData: previousData => previousData,
  })

  const animatedWeatherEntities = useMemo(
    () => weatherAnimationEnabled
      ? worldContextEntities(weatherGridContext).filter(entity =>
          entity.entityType === 'weather' &&
          Number.isFinite(entity.latitude) && Number.isFinite(entity.longitude) &&
          entity.latitude >= -90 && entity.latitude <= 90 &&
          entity.longitude >= -180 && entity.longitude <= 180)
      : [],
    [weatherAnimationEnabled, weatherGridContext],
  )
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
    queryKey: ['gev-cctv-catalog', worldViewport.latitude, worldViewport.longitude, worldViewport.radiusM, worldViewport.bbox?.join(',')],
    queryFn: async () => {
      const response = await api.get<{
        data: SpatialWorldEntity[]
        health?: { recordCount?: number; acceptedCount?: number; status?: string }
        coverage?: { complete?: boolean; bounded?: boolean; queryScope?: string; providers?: Record<string, { status?: string; recordCount?: number; total?: number | null; free?: number | null }> }
        warnings?: string[]
      }>('/cctv/cameras', {
        params: {
          ...(worldViewport.bbox
            ? { bbox: worldViewport.bbox.join(',') }
            : { lat: worldViewport.latitude, lng: worldViewport.longitude, radiusM: Math.min(100000, worldViewport.radiusM) }),
          limit: 180,
        },
      })
      return response.data
    },
    enabled: view === '3D' && cctvOpen,
    staleTime: 45_000,
    refetchInterval: 60_000,
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
    const byId = new Map<string, SpatialWorldEntity>()
    for (const entity of externalEntities) {
      // When the explicit viewport grid is active, replace rather than duplicate the base context's coarser weather samples.
      if ((weatherAnimationEnabled || liveSimulationEnabled) && entity.entityType === 'weather') continue
      byId.set(entity.id, entity)
    }
    if (weatherAnimationEnabled && !liveSimulationEnabled) for (const entity of animatedWeatherEntities) byId.set(entity.id, entity)
    for (const entity of liveSimulationEntities) byId.set(entity.id, entity)
    if (cctvOpen) for (const entity of cctvEntities) byId.set(entity.id, entity)
    return Array.from(byId.values())
  }, [externalEntities, animatedWeatherEntities, liveSimulationEntities, cctvEntities, cctvOpen, weatherAnimationEnabled, liveSimulationEnabled])
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
      // Keep the explicit weather viewport grid visible even when other world layers are dense.
      ...(weatherAnimationEnabled && !liveSimulationEnabled ? animatedWeatherEntities : []),
      ...(liveSimulationEnabled ? liveSimulationEntities : []),
      ...cameras,
      ...priorityLayers.flatMap(layer => filtered.filter(entity => spatialEntityLayer(entity) === layer)),
    ]
    const seen = new Set<string>()
    return ordered.filter(entity => {
      if (seen.has(entity.id)) return false
      seen.add(entity.id)
      return true
    }).slice(0, MAX_RENDER_MARKERS)
  }, [allExternalEntities, visibleLayers, externalVisible, selectedExternalId, weatherAnimationEnabled, animatedWeatherEntities, liveSimulationEnabled, liveSimulationEntities])

  useEffect(() => {
    if (view !== '3D' || positionedVehicles.length === 0 || worldViewportSeededRef.current) return
    worldViewportSeededRef.current = true
    setWorldViewport({ ...initialWorldCenter, radiusM: 100000 })
  }, [view, positionedVehicles.length, initialWorldCenter])

  const layerCounts = useMemo(() => {
    const result = Object.fromEntries(WORLD_CONTEXT_LAYERS.map(layer => [layer, 0])) as Record<WorldContextLayer, number>
    const baseEntities = externalEntities.filter(entity => !((weatherAnimationEnabled || liveSimulationEnabled) && entity.entityType === 'weather'))
    const renderedWeather = weatherAnimationEnabled && !liveSimulationEnabled ? animatedWeatherEntities : []
    for (const entity of [...baseEntities, ...renderedWeather, ...liveSimulationEntities]) {
      const layer = spatialEntityLayer(entity)
      if (layer) result[layer] += 1
    }
    return result
  }, [externalEntities, liveSimulationEntities, weatherAnimationEnabled, liveSimulationEnabled, animatedWeatherEntities])

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
      data-navigation-expanded={mapNavigationExpanded}
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
          <button
            type="button"
            className="gev-segment gev-weather-toggle"
            aria-pressed={weatherAnimationEnabled}
            title={weatherAnimationEnabled
              ? 'Turn off animated weather grid points. Animation is visual only; points are provider-returned model grid locations, not radar footprints.'
              : 'Animate sourced weather model-grid observations across the current map viewport.'}
            onClick={() => {
              setLiveSimulationEnabled(false)
              setSimulationPlaying(false)
              setWeatherAnimationEnabled(enabled => {
                const next = !enabled
                if (next) {
                  setExternalVisible(true)
                  setVisibleLayers(current => current.has('weather') ? current : new Set([...current, 'weather']))
                  setIntelligenceOpen(true)
                }
                return next
              })
            }}
          >
            <CloudLightning size={13} />
            WEATHER
            <span>{weatherAnimationEnabled ? (weatherGridFetching ? 'SYNC' : weatherGridError ? 'ERROR' : String(animatedWeatherEntities.length)) : 'OFF'}</span>
          </button>
          <button
            type="button"
            className="gev-segment gev-live-sim-toggle"
            aria-pressed={liveSimulationEnabled}
            title={liveSimulationEnabled
              ? 'Stop the forecast timeline and live earthquake / reported volcano overlays.'
              : 'Show the hourly weather-model timeline, USGS earthquakes, Smithsonian/USGS global volcano reports, current USGS elevated volcano alerts, and NASA EONET natural events.'}
            onClick={() => {
              const next = !liveSimulationEnabled
              setLiveSimulationEnabled(next)
              setWeatherAnimationEnabled(false)
              setSimulationPlaying(false)
              setForecastStepIndex(0)
              if (next) {
                setExternalVisible(true)
                setIntelligenceOpen(true)
                setVisibleLayers(current => new Set([...current, 'weather', 'hazards']))
              }
            }}
          >
            <Activity size={13} /> LIVE SIM
            <span>{liveSimulationEnabled ? (liveSimulationFetching ? 'SYNC' : liveSimulationError ? 'ERROR' : String(simulationNaturalEvents.length)) : 'OFF'}</span>
          </button>
        </div>

        <div className="gev-topright">
          <div className="gev-ai-badge" title="Open-source Real-ESRGAN enhancement is applied to deep-zoom photographic imagery when the device can run it safely. Source imagery remains authoritative.">
            <span className="gev-ai-badge-dot" />
            {imageryAiSupported() ? imageryAiBadge() : 'SOURCE IMAGE'}
          </div>
          <div className="gev-health" data-state={syncState} aria-live="polite">
            <span className="gev-health-dot" />
            <span className="gev-health-label">{worldError ? 'Context degraded' : worldFetching ? 'Context syncing' : 'Context ready'}</span>
          </div>
          <div className="gev-clock" aria-label="UTC time">
            <span>UTC {formatUtcClock(clock)}</span>
            <span>{worldViewport.latitude.toFixed(3)}° · {worldViewport.longitude.toFixed(3)}°</span>
          </div>
        </div>
      </header>

      {liveSimulationEnabled && (
        <section className="gev-simulation-console" aria-label="Live event simulation controls">
          <div className="gev-simulation-console-head">
            <div className="gev-simulation-heading">
              <span className="gev-simulation-status-dot" data-state={(liveSimulationError && !liveSimulationResult) || liveSimulationResult?.health?.status === 'UNAVAILABLE' ? 'error' : liveSimulationFetching || liveSimulationError || liveSimulationResult?.health?.status === 'PARTIAL' ? 'sync' : 'ready'} />
              <div>
                <div className="gev-simulation-eyebrow">LIVE EVENT SIMULATION{liveSimulationResult?.health?.status ? ' · ' + String(liveSimulationResult.health.status) : ''}</div>
                <div className="gev-simulation-time">{formatForecastTime(selectedForecastTime)
                  ?? (liveSimulationFetching
                    ? 'SYNCING FORECAST'
                    : liveSimulationResult?.health?.weather?.status === 'UNAVAILABLE'
                      ? 'FORECAST UNAVAILABLE'
                      : 'FORECAST TIME N/A')}</div>
              </div>
            </div>
            <div className="gev-simulation-actions">
              <button type="button" className="gev-simulation-play" onClick={() => setSimulationPlaying(value => !value)} disabled={simulationForecastSteps.length < 2} aria-label={simulationPlaying ? 'Pause forecast timeline' : 'Play forecast timeline'} title={simulationPlaying ? 'Pause simulation' : 'Play simulation'}>
                {simulationPlaying ? <Pause size={13} /> : <Play size={13} />}
                <span>{simulationPlaying ? 'PAUSE' : 'PLAY'}</span>
              </button>
              <button type="button" className="gev-simulation-close" onClick={() => { setLiveSimulationEnabled(false); setSimulationPlaying(false) }} aria-label="Close live simulation" title="Close live simulation"><X size={14} /></button>
            </div>
          </div>
          <div className="gev-simulation-timeline-row">
            <span className="gev-simulation-timeline-label">{formatForecastTick(simulationForecastSteps[0]?.validAt) ?? 'START'}</span>
            <input className="gev-simulation-range" type="range" min={0} max={Math.max(0, simulationForecastSteps.length - 1)} step={1} disabled={simulationForecastSteps.length < 2} value={Math.min(forecastStepIndex, Math.max(0, simulationForecastSteps.length - 1))} onChange={event => { setForecastStepIndex(Number(event.target.value)); setSimulationPlaying(false) }} aria-label="Weather forecast valid time; drag to select an hourly model step" />
            <span className="gev-simulation-timeline-label">{formatForecastTick(simulationForecastSteps[simulationForecastSteps.length - 1]?.validAt) ?? 'END'}</span>
          </div>
          <div className="gev-simulation-summary">
            <span><i data-tone="weather" />{simulationWeatherEntities.length} MODEL POINTS</span>
            <span><i data-tone="quake" />{Number(liveSimulationResult?.health?.earthquakes?.recordCount ?? simulationNaturalEvents.filter(entity => entity.entityType === 'earthquake').length)} M2.5+ QUAKES / 24H</span>
            <span><i data-tone="volcano" />{simulationNaturalEvents.filter(entity => entity.entityType === 'volcano').length} VOLCANO SIGNALS</span>
            <span><i data-tone="natural" />{Number(liveSimulationResult?.health?.eonet?.recordCount ?? simulationNaturalEvents.filter(entity => entity.entityType === 'natural_event').length)} OPEN EONET EVENTS</span>
          </div>
          <div className="gev-simulation-footnote">
            Weather model data by <a href={safeExternalUrl(liveSimulationResult?.sources?.weather, liveSimulationResult?.health?.weather?.source === 'met-no' ? 'https://api.met.no/weatherapi/locationforecast/2.0/documentation' : 'https://open-meteo.com/en/docs')} target="_blank" rel="noreferrer">{liveSimulationResult?.health?.weather?.source === 'met-no' ? 'MET Norway' : 'Open-Meteo'}</a> · earthquakes from USGS ComCat · volcano alerts from USGS · global volcano bulletins from Smithsonian GVP. The forecast is modelled and visual pulses are not hazard footprints.
            {liveSimulationResult?.warnings?.some(warning => warning.includes('commercial_api_key_not_configured')) && (
              <strong className="gev-simulation-config-warning"> WEATHER FORECAST DISABLED: configure the licensed OPEN_METEO_API_KEY on the backend. Do not enable the free API for commercial use.</strong>
            )}
            {liveSimulationResult?.warnings?.filter(warning => !warning.includes('commercial_api_key_not_configured')).slice(0, 2).map((warning, index) => (
              <span key={warning + index}> · SOURCE WARNING: {warning.replaceAll('_', ' ')}</span>
            ))}
          </div>
        </section>
      )}

      <main className="gev-workspace">
        <section className="gev-stage" aria-label="Sonalit God’s Eye View map">
          {view === '2D' ? (
            <FleetMap
              vehicles={allVehicles}
              selectedId={selected?.id ?? null}
              onSelect={vehicle => { setSelected(vehicle); setSelectedExternalId(null) }}
              weatherAnimationEnabled={weatherAnimationEnabled || liveSimulationEnabled}
              weatherEvents={liveSimulationEnabled ? (visibleLayers.has('weather') ? simulationWeatherEntities : []) : (visibleLayers.has('weather') ? animatedWeatherEntities : [])}
              naturalEvents={liveSimulationEnabled && visibleLayers.has('hazards') ? simulationNaturalEvents : []}
              onNaturalEventSelect={entity => { setSelectedExternalId(entity.id); setSelected(null); setIntelligenceOpen(true) }}
              onWeatherSelect={entity => { setSelectedExternalId(entity.id); setSelected(null); setIntelligenceOpen(true) }}
              onViewportChange={setWorldViewport}
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
              onNavigationExpandedChange={setMapNavigationExpanded}
              worldEntities={renderableExternalEntities}
              weatherAnimationEnabled={weatherAnimationEnabled || liveSimulationEnabled}
              selectedExternalId={selectedExternalId}
              onExternalSelect={id => {
                setSelectedExternalId(id)
                setSelected(null)
                if (id) setIntelligenceOpen(true)
                const entity = allExternalEntities.find(candidate => candidate.id === id)
                if (entity?.entityType === 'camera' || entity?.entityType === 'spatial_camera') setCctvOpen(true)
              }}
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
              publicTotal={cctvPublicTotal}
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
                  {selectedExternal.entityType === 'weather' ? (
                    <div className="gev-weather-observation-card" aria-label="Weather observation detail">
                      <div className="gev-weather-observation-head">
                        <CloudLightning size={17} />
                        <div>
                          <div className="gev-weather-condition">{String(selectedExternal.attributes?.conditions ?? 'unknown').replaceAll('_', ' ')}</div>
                          <div className="gev-weather-subcondition">{String(selectedExternal.attributes?.severity ?? selectedExternal.status ?? 'unclassified').toUpperCase()} · MODEL GRID POINT</div>
                        </div>
                      </div>
                      <div className="gev-weather-detail-grid">
                        <div><span>Temperature</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.temperatureC)) ? Number(selectedExternal.attributes?.temperatureC).toFixed(1) + ' °C' : '—'}</strong></div>
                        <div><span>Humidity</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.humidityPct)) ? Math.round(Number(selectedExternal.attributes?.humidityPct)) + '%' : '—'}</strong></div>
                        <div><span>Precipitation</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.precipitationMm)) ? Number(selectedExternal.attributes?.precipitationMm).toFixed(1) + ' mm' : '—'}</strong></div>
                        <div><span>Wind</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.windSpeedKmh)) ? Number(selectedExternal.attributes?.windSpeedKmh).toFixed(1) + ' km/h' : '—'}</strong></div>
                        <div><span>Visibility</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.visibilityM)) ? (Number(selectedExternal.attributes?.visibilityM) >= 1000 ? (Number(selectedExternal.attributes?.visibilityM) / 1000).toFixed(1) + ' km' : Math.round(Number(selectedExternal.attributes?.visibilityM)) + ' m') : '—'}</strong></div>
                        <div><span>Weather code</span><strong>{selectedExternal.attributes?.weatherCode != null ? String(selectedExternal.attributes.weatherCode) : '—'}</strong></div>
                      </div>
                      <div className="gev-weather-location">
                        <div><span>Provider grid coordinate</span><strong>{selectedExternal.latitude.toFixed(4)}°, {selectedExternal.longitude.toFixed(4)}°</strong></div>
                        <div><span>Grid snap from sample centre</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.gridCellDistanceM)) ? Math.round(Number(selectedExternal.attributes?.gridCellDistanceM)) + ' m' : '—'}</strong></div>
                        <div><span>{selectedExternal.attributes?.simulationMode === 'hourly_forecast' ? 'Forecast valid at' : 'Observed at'}</span><strong>{selectedExternal.attributes?.simulationMode === 'hourly_forecast' && selectedExternal.attributes?.validAt ? new Date(String(selectedExternal.attributes.validAt)).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : selectedExternal.observedAt ? new Date(selectedExternal.observedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'Time unavailable'}</strong></div>
                        <div><span>Source / freshness</span><strong>{String(selectedExternal.source ?? 'unknown')} · {String(selectedExternal.quality?.freshnessClass ?? 'UNKNOWN')}</strong></div>
                      </div>
                      <div className="gev-weather-footnote">
                        {selectedExternal.attributes?.simulationMode === 'hourly_forecast' ? 'Animation steps through a numerical weather forecast for this grid point, valid at the selected timeline time. It is not observed weather, a radar return, or an exact storm boundary.' : 'Animation illustrates the reported condition at this provider grid point. It does not represent a radar return, exact storm boundary, or guaranteed on-ground measurement.'}
                        {Array.isArray(selectedExternal.attributes?.hazards) && selectedExternal.attributes.hazards.length > 0
                          ? ' Indicators: ' + (selectedExternal.attributes?.hazards as unknown[]).map(String).join(', ').replaceAll('_', ' ')
                          : ''}
                      </div>
                    </div>
                  ) : selectedExternal.entityType === 'earthquake' ? (
                    <div className="gev-natural-event-card" data-event-type="earthquake" aria-label="Earthquake event details">
                      <div className="gev-natural-event-title">{String(selectedExternal.attributes?.title ?? selectedExternal.attributes?.place ?? 'Earthquake')}</div>
                      <div className="gev-natural-event-note">USGS-catalogued earthquake epicentre. The marker is a symbolic event locator, not a measured shaking footprint or a prediction of damage.</div>
                      <div className="gev-natural-event-meta">
                        <div><span>Magnitude</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.magnitude)) ? 'M' + Number(selectedExternal.attributes?.magnitude).toFixed(1) : '—'}</strong></div>
                        <div><span>Depth</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.depthKm)) ? Number(selectedExternal.attributes?.depthKm).toFixed(1) + ' km' : '—'}</strong></div>
                        <div><span>Event time (UTC)</span><strong>{selectedExternal.observedAt ? new Date(selectedExternal.observedAt).toISOString().slice(0, 19).replace('T', ' ') : '—'}</strong></div>
                        <div><span>Tsunami flag</span><strong>{selectedExternal.attributes?.tsunami === true ? 'YES · CHECK OFFICIAL ALERTS' : 'NOT FLAGGED'}</strong></div>
                        <div><span>Location</span><strong>{String(selectedExternal.attributes?.place ?? 'Unknown')}</strong></div>
                        <div><span>Catalog freshness</span><strong>{String(selectedExternal.quality?.freshnessClass ?? 'UNKNOWN')}</strong></div>
                      </div>
                      <div className="gev-natural-event-source">SOURCE: USGS COMCAT · EVENT RECORD<br />
                        <a href={safeExternalUrl(selectedExternal.attributes?.detailUrl, 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php')} target="_blank" rel="noreferrer">OPEN USGS EVENT DETAILS ↗</a>
                      </div>
                    </div>
                  ) : selectedExternal.entityType === 'volcano' || selectedExternal.entityType === 'volcanic_activity' ? (
                    <div className="gev-natural-event-card" data-event-type="volcano" aria-label="Volcano report details">
                      <div className="gev-natural-event-title">{String(selectedExternal.attributes?.name ?? 'Volcano activity report')}</div>
                      <div className="gev-natural-event-note">{String(selectedExternal.attributes?.reportText ?? 'No report summary was supplied by the provider.')}</div>
                      <div className="gev-natural-event-meta">
                        <div><span>Reported activity</span><strong>{String(selectedExternal.attributes?.reportType ?? selectedExternal.status ?? 'REPORTED').replaceAll('_', ' ')}</strong></div>
                        <div><span>Country / region</span><strong>{[selectedExternal.attributes?.country, selectedExternal.attributes?.region].filter(Boolean).map(String).join(' · ') || '—'}</strong></div>
                        <div><span>Report date (UTC)</span><strong>{selectedExternal.observedAt ? new Date(selectedExternal.observedAt).toISOString().slice(0, 19).replace('T', ' ') : '—'}</strong></div>
                        <div><span>Reporting cadence</span><strong>{String(selectedExternal.attributes?.reportingCadence ?? 'weekly').toUpperCase()}</strong></div>
                        <div><span>Elevation</span><strong>{Number.isFinite(Number(selectedExternal.attributes?.elevationM)) ? Math.round(Number(selectedExternal.attributes?.elevationM)) + ' m' : '—'}</strong></div>
                        <div><span>Report quality</span><strong>{String(selectedExternal.quality?.freshnessClass ?? 'UNKNOWN')}</strong></div>
                        <div><span>USGS alert / aviation code</span><strong>{String((selectedExternal.attributes?.usgsCurrentAlert as Record<string, unknown> | undefined)?.alertLevel ?? 'NO ELEVATED ALERT')} · {String((selectedExternal.attributes?.usgsCurrentAlert as Record<string, unknown> | undefined)?.colorCode ?? '—')}</strong></div>
                        <div><span>USGS notice time (UTC)</span><strong>{(selectedExternal.attributes?.usgsCurrentAlert as Record<string, unknown> | undefined)?.noticeIssuedAt ? new Date(String((selectedExternal.attributes?.usgsCurrentAlert as Record<string, unknown>).noticeIssuedAt)).toISOString().slice(0, 19).replace('T', ' ') : '—'}</strong></div>
                      </div>
                      <div className="gev-natural-event-source">SMITHSONIAN GLOBAL VOLCANISM PROGRAM / USGS<br />
                        {selectedExternal.attributes?.usgsCurrentAlert ? 'USGS currently lists this volcano in an elevated alert state. The issue timestamp shown above identifies the notice that established the alert; it is not the time of a fresh sensor measurement.' : 'Global activity comes from the weekly bulletin; no current elevated USGS alert was returned for this volcano.'} The weekly bulletin itself is not a real-time vent camera, ash plume, or complete global monitoring feed.<br />
                        {(selectedExternal.attributes?.usgsCurrentAlert as Record<string, unknown> | undefined)?.noticeUrl && <><a href={safeExternalUrl((selectedExternal.attributes?.usgsCurrentAlert as Record<string, unknown>).noticeUrl, 'https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes')} target="_blank" rel="noreferrer">OPEN USGS CURRENT ALERT ↗</a><br /></>}
                        <a href={safeExternalUrl(selectedExternal.attributes?.reportUrl, 'https://volcano.si.edu/reports_weekly.cfm')} target="_blank" rel="noreferrer">OPEN VOLCANO SOURCE REPORT ↗</a>
                      </div>
                    </div>
                  ) : selectedExternal.entityType === 'natural_event' ? (
                    <div className="gev-natural-event-card" data-event-type="natural-event" aria-label="NASA EONET natural event details">
                      <div className="gev-natural-event-title">{String(selectedExternal.attributes?.categoryTitle ?? selectedExternal.attributes?.categoryId ?? 'Natural event')}</div>
                      <div className="gev-entity-title" style={{ fontSize: 18, marginTop: 7 }}>{String(selectedExternal.attributes?.title ?? selectedExternal.attributes?.name ?? 'Open natural event')}</div>
                      <div className="gev-natural-event-note">{String(selectedExternal.attributes?.description ?? 'NASA EONET did not include an event description.')}</div>
                      <div className="gev-natural-event-meta">
                        <div><span>Event state</span><strong>{String(selectedExternal.status ?? 'OPEN').toUpperCase()}</strong></div>
                        <div><span>Category</span><strong>{String(selectedExternal.attributes?.categoryId ?? '—')}</strong></div>
                        <div><span>Event geometry</span><strong>{String(selectedExternal.attributes?.sourceGeometryType ?? 'UNKNOWN').toUpperCase()}</strong></div>
                        <div><span>Geometry points</span><strong>{String(selectedExternal.attributes?.sourceCoordinateCount ?? '—')}</strong></div>
                        <div><span>Event date (UTC)</span><strong>{selectedExternal.attributes?.eventDate ? new Date(String(selectedExternal.attributes.eventDate)).toISOString().slice(0, 19).replace('T', ' ') : '—'}</strong></div>
                        <div><span>Feed freshness</span><strong>{String(selectedExternal.quality?.freshnessClass ?? 'UNKNOWN')}</strong></div>
                        <div><span>Marker coordinate</span><strong>{selectedExternal.latitude.toFixed(4)}°, {selectedExternal.longitude.toFixed(4)}°</strong></div>
                        <div><span>Location semantics</span><strong>{String(selectedExternal.attributes?.locationSemantics ?? 'SOURCE EVENT LOCATOR').replaceAll('_', ' ')}</strong></div>
                      </div>
                      <div className="gev-natural-event-source">
                        NASA EARTH OBSERVATORY NATURAL EVENT TRACKER (EONET)<br />
                        The map marker is the source point or a centre calculated from source geometry. It is not a substitute for the original event boundary, live sensor stream, or measured damage footprint.<br />
                        <a href={safeExternalUrl(selectedExternal.attributes?.eventLink, 'https://eonet.gsfc.nasa.gov/')} target="_blank" rel="noreferrer">OPEN NASA EONET EVENT ↗</a>
                        {(() => {
                          const links = (selectedExternal.attributes?.sourceLinks as Array<Record<string, unknown>> | undefined) ?? []
                          return links.slice(0, 3).map((item, index) => {
                            const url = safeExternalUrl(item.url, '')
                            if (!url) return null
                            return <Fragment key={url + index}><br /><a href={url} target="_blank" rel="noreferrer">OPEN {String(item.title ?? item.id ?? 'SOURCE').toUpperCase()} ↗</a></Fragment>
                          })
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="gev-detail-callout" style={{ marginTop: 9, border: '1px solid rgba(184,166,255,.10)', borderRadius: 10 }}>
                      <div className="gev-detail-label">{selectedExternal.entityType === 'satellite' ? 'Modelled orbital position' : selectedExternal.entityType === 'spatial_camera' || selectedExternal.entityType === 'camera' ? 'Camera observation' : selectedExternal.telemetryLive === true ? 'Live external telemetry' : 'External observation'}</div>
                      <div className="gev-detail-note">{selectedExternal.entityType === 'satellite' ? 'Not live telemetry · not an imaging or tasking claim.' : selectedExternal.entityType === 'spatial_camera' || selectedExternal.entityType === 'camera' ? 'Geometry indicates possible visibility only. Approved camera media is opened in the CCTV viewer.' : 'Source and quality controls remain visible to the operator.'}</div>
                      {(selectedExternal.entityType === 'camera' || selectedExternal.entityType === 'spatial_camera') && (
                        <button type="button" className="gev-cctv-inline-action" onClick={openCctv}><Camera size={12} /> OPEN CCTV VIEWER</button>
                      )}
                    </div>
                  )}
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
              {weatherAnimationEnabled && <><span className="gev-ribbon-sep" /><span className="gev-ribbon-item">Weather grid <strong>{animatedWeatherEntities.length} GRID POINTS</strong> <strong>{weatherGridError ? 'DEGRADED' : weatherGridFetching ? 'SYNCING' : String(weatherGridContext?.layerHealth?.find(health => health.layerId === 'weather')?.status ?? 'POINT SAMPLES')}</strong></span></>}
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
