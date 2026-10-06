import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, CheckCircle2, ChevronRight, Clock3, Cloud,
  CloudRain, Crosshair, Database, Eye, Layers3, LocateFixed, Map as MapIcon,
  Maximize2, RefreshCw, Satellite, ShieldAlert, Thermometer, Wind, XCircle, ZoomIn, ZoomOut,
} from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../styles/optical-recon.css'
import { STREET_STYLE } from '../lib/mapStyles.js'
import { fetchOpticalRecon, installOpticalReconMapLibreProtocol, reconStyle, type OpticalReconResult, type OpticalCandidate } from '../lib/opticalRecon.js'
import { fetchWorldContext, type SpatialWorldContext } from '../lib/spatialClient.js'
import { spatialCanvasContextAttributes, spatialPixelRatio } from '../lib/spatialRendering.js'

installOpticalReconMapLibreProtocol()

type MapMode = 'normal' | 'latest' | 'precision'

const DEFAULT_AOI = { latitude: -1.286389, longitude: 36.817223 }

function ageLabel(value?: string | null) {
  if (!value) return '—'
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return '—'
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000))
  if (mins < 60) return mins + 'm'
  const hours = Math.floor(mins / 60)
  if (hours < 48) return hours + 'h'
  return Math.floor(hours / 24) + 'd'
}

function dateLabel(value?: string | null) {
  if (!value) return 'Not available'
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  return new Date(t).toLocaleString([], {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}

function sourceLabel(source?: string) {
  if (source === 'sentinel') return 'SENTINEL-2 / DE AFRICA'
  if (source === 'oam') return 'OPENAERIALMAP'
  if (source === 'nasa') return 'NASA GIBS / MODIS'
  return 'UNKNOWN SOURCE'
}

function missionLabel(candidate?: OpticalCandidate | null) {
  if (!candidate) return 'No observation'
  return candidate.mission || candidate.provider || 'Unnamed observation'
}

function normaliseWeather(ctx?: SpatialWorldContext) {
  return ctx?.environment?.find(x => x.entityType === 'weather') ?? ctx?.entities?.find(x => x.entityType === 'weather')
}

function qualityLabel(state?: string) {
  switch (state) {
    case 'available': return 'VALIDATED'
    case 'available_with_provider_warnings': return 'VALIDATED / WARNINGS'
    case 'provider_degraded_fallback': return 'FALLBACK / DEGRADED'
    case 'fallback': return 'RAPID FALLBACK'
    default: return 'NO CERTIFIED SCENE'
  }
}

function qualityTone(state?: string) {
  if (state === 'available') return 'ok'
  if (state === 'available_with_provider_warnings') return 'warn'
  if (state === 'fallback' || state === 'provider_degraded_fallback') return 'fallback'
  return 'bad'
}

function scorePct(candidate?: OpticalCandidate | null) {
  if (!candidate) return 0
  return Math.max(0, Math.min(100, Math.round(Number(candidate.score || 0) * 100)))
}

function sourceState(recon: OpticalReconResult | undefined, source: 'sentinel' | 'oam' | 'nasa') {
  if (!recon) return 'PENDING'
  if (source === 'sentinel') {
    if (recon.warnings.includes('sentinel_catalog_unavailable')) return 'DEGRADED'
    return recon.coverage.sentinel2Scenes > 0 ? 'AVAILABLE' : 'NO SCENES'
  }
  if (source === 'oam') {
    if (recon.warnings.includes('openaerialmap_catalog_unavailable')) return 'DEGRADED'
    return recon.coverage.openAerialMapCandidates > 0 ? 'AVAILABLE' : 'NO CANDIDATES'
  }
  return recon.primary?.render?.source === 'nasa' ? 'ACTIVE FALLBACK' : 'STANDING BY'
}

export default function OpticalRecon() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapMode, setMapMode] = useState<MapMode>('normal')
  const [centre, setCentre] = useState(DEFAULT_AOI)
  const [aoiVersion, setAoiVersion] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const opticalQ = useQuery<OpticalReconResult>({
    queryKey: ['optical-recon-workstation', centre.latitude, centre.longitude, aoiVersion],
    queryFn: ({ signal }) => fetchOpticalRecon(centre, 35_000, signal),
    enabled: mapReady,
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: 1,
  })

  const worldQ = useQuery<SpatialWorldContext>({
    queryKey: ['optical-recon-context', centre.latitude, centre.longitude],
    queryFn: ({ signal }) => fetchWorldContext({
      center: centre,
      radiusM: 50_000,
      layers: ['weather', 'hazards', 'security', 'incidents'],
      maxEntitiesPerLayer: 50,
      signal,
    }),
    enabled: mapReady,
    staleTime: 30_000,
    refetchInterval: 120_000,
    retry: 1,
  })

  const recon = opticalQ.data
  const candidates = useMemo(
    () => (recon?.candidates ?? []).slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0)),
    [recon],
  )
  const viewed = useMemo(() => {
    if (!recon) return null
    if (selectedId) return candidates.find(candidate => candidate.id === selectedId) ?? recon.primary
    if (mapMode === 'precision') return recon.precisionAlternative ?? recon.primary
    return recon.primary
  }, [candidates, mapMode, recon, selectedId])

  const weather = normaliseWeather(worldQ.data)
  const weatherAttrs = (weather?.attributes ?? {}) as Record<string, unknown>
  const hazardCount = (worldQ.data?.hazards?.length ?? 0) + (worldQ.data?.incidents?.length ?? 0)
  const securityCount = (worldQ.data?.security?.length ?? 0) + (worldQ.data?.operational?.alerts?.length ?? 0)
  const state = qualityTone(recon?.quality.state)
  const queryBusy = opticalQ.isFetching && !opticalQ.data
  const degraded = opticalQ.isError || worldQ.isError || (recon?.warnings.length ?? 0) > 0

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STREET_STYLE,
      center: [DEFAULT_AOI.longitude, DEFAULT_AOI.latitude],
      zoom: 7,
      attributionControl: false,
      pixelRatio: spatialPixelRatio(),
      maxCanvasSize: [8192, 8192],
      canvasContextAttributes: spatialCanvasContextAttributes,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: false }), 'bottom-right')
    map.on('style.load', () => setMapReady(true))
    map.on('click', event => {
      const next = { latitude: event.lngLat.lat, longitude: event.lngLat.lng }
      setCentre(next)
      setAoiVersion(value => value + 1)
      setSelectedId(null)
      setMapMode('latest')
      markerRef.current?.remove()
      markerRef.current = new maplibregl.Marker({ color: '#5eead4', scale: 0.75 })
        .setLngLat(event.lngLat)
        .addTo(map)
    })
    mapRef.current = map
    return () => {
      markerRef.current?.remove()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current || !viewed?.render || mapMode === 'normal') return
    setMapReady(false)
    mapRef.current.setStyle(reconStyle(viewed.render))
  }, [mapMode, viewed?.render?.source, viewed?.render?.date, viewed?.render?.itemId])

  useEffect(() => {
    if (!mapRef.current || !opticalQ.error || mapMode === 'normal') return
    setMapMode('normal')
    setSelectedId(null)
    setMapReady(false)
    mapRef.current.setStyle(STREET_STYLE)
  }, [opticalQ.error, mapMode])

  useEffect(() => {
    if (!opticalQ.isFetching) setRefreshing(false)
  }, [opticalQ.isFetching])

  const refreshAoi = () => {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter()
    setCentre({ latitude: c.lat, longitude: c.lng })
    setAoiVersion(value => value + 1)
    setSelectedId(null)
    setRefreshing(true)
    setMapMode('latest')
    markerRef.current?.remove()
  }

  const selectCandidate = (candidate: OpticalCandidate) => {
    setSelectedId(candidate.id)
    if (!candidate.render) return
    setMapMode(candidate.render.source === 'oam' ? 'precision' : 'latest')
  }

  const returnNormal = () => {
    setSelectedId(null)
    setMapMode('normal')
    setMapReady(false)
    mapRef.current?.setStyle(STREET_STYLE)
  }

  return (
    <div className="ore-root">
      <header className="ore-header">
        <div className="ore-brand">
          <div className="ore-mark"><Satellite size={18} /></div>
          <div className="ore-title-block">
            <div className="ore-eyebrow">SONALIT / SECURITY / EARTH OBSERVATION</div>
            <h1>OPTICAL RECONNAISSANCE</h1>
            <p>Scene evidence workstation · acquisition metadata · operational context · source provenance</p>
          </div>
        </div>
        <div className="ore-header-right">
          <div className={'ore-integrity-chip ' + state}>
            <span>{state === 'ok' ? '●' : state === 'warn' ? '●' : state === 'fallback' ? '△' : '×'}</span>
            {qualityLabel(recon?.quality.state)}
          </div>
          <button type="button" className="ore-button ghost" onClick={refreshAoi} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? 'ore-spin' : ''} />
            REFRESH SCENE
          </button>
        </div>
      </header>

      <div className="ore-commandbar">
        <div className="ore-command-modes">
          <button type="button" className={mapMode === 'normal' ? 'active' : ''} onClick={returnNormal}>
            <MapIcon size={13} /> OPERATIONAL MAP
          </button>
          <button type="button" className={mapMode === 'latest' ? 'active' : ''} onClick={() => { setSelectedId(null); setMapMode('latest') }}>
            <Satellite size={13} /> LATEST OBSERVATION
          </button>
          <button type="button" className={mapMode === 'precision' ? 'active precision' : 'precision'} onClick={() => {
            if (recon?.precisionAlternative) {
              setSelectedId(recon.precisionAlternative.id)
              setMapMode('precision')
            }
          }} disabled={!recon?.precisionAlternative}>
            <Maximize2 size={13} /> DETAIL SCENE
          </button>
        </div>
        <div className="ore-aoi-readout">
          <Crosshair size={13} />
          <span>{centre.latitude.toFixed(5)}°</span>
          <span>{centre.longitude.toFixed(5)}°</span>
          <b>AOI 35 KM</b>
          <span className="ore-gesture">Click map to retarget</span>
        </div>
      </div>

      <div className="ore-workspace">
        <aside className="ore-left">
          <section className="ore-panel ore-scene-card">
            <div className="ore-panel-title">
              <div><span>SCENE BRIEF</span><strong>{missionLabel(viewed)}</strong></div>
              {viewed && <span className="ore-score">{scorePct(viewed)}%</span>}
            </div>
            <div className="ore-scene-line">
              <span className="ore-scene-status"><i /> {viewed?.freshness || 'AWAITING SEARCH'}</span>
              <span>{viewed?.provider || 'catalog pending'}</span>
            </div>
            <div className="ore-big-metric">
              <strong>{viewed?.nativeResolutionM ? String(viewed.nativeResolutionM) + ' m' : '—'}</strong>
              <span>NATIVE GROUND SAMPLE</span>
            </div>
            <div className="ore-metric-grid">
              <div><span>ACQUIRED</span><b>{dateLabel(viewed?.acquiredAt)}</b></div>
              <div><span>AGE</span><b>{ageLabel(viewed?.acquiredAt)}</b></div>
              <div><span>CLOUD</span><b>{viewed?.cloudPct != null ? viewed.cloudPct.toFixed(1) + '%' : '—'}</b></div>
              <div><span>SOURCE</span><b>{sourceLabel(viewed?.render?.source)}</b></div>
            </div>
            <div className="ore-recommendation">
              <Eye size={13} />
              <span>{viewed?.recommendation || 'Awaiting the validated scene selection for this AOI.'}</span>
            </div>
          </section>

          <section className="ore-panel">
            <div className="ore-panel-title compact"><div><span>SOURCE POSTURE</span><strong>CATALOG FABRIC</strong></div><Database size={14} /></div>
            <div className="ore-source">
              <div className="ore-source-mark sentinel"><Satellite size={13} /></div>
              <div className="ore-source-copy"><strong>Sentinel-2</strong><span>10 m optical backbone</span></div>
              <em className={sourceState(recon, 'sentinel') === 'DEGRADED' ? 'warn' : 'ok'}>{sourceState(recon, 'sentinel')}</em>
            </div>
            <div className="ore-source">
              <div className="ore-source-mark aerial"><LocateFixed size={13} /></div>
              <div className="ore-source-copy"><strong>OpenAerialMap</strong><span>higher-detail aerial candidates</span></div>
              <em className={sourceState(recon, 'oam') === 'DEGRADED' ? 'warn' : 'ok'}>{sourceState(recon, 'oam')}</em>
            </div>
            <div className="ore-source">
              <div className="ore-source-mark nasa"><Cloud size={13} /></div>
              <div className="ore-source-copy"><strong>NASA GIBS / MODIS</strong><span>rapid-observation fallback</span></div>
              <em className={sourceState(recon, 'nasa').includes('FALLBACK') ? 'fallback' : 'muted'}>{sourceState(recon, 'nasa')}</em>
            </div>
            <div className="ore-coverage">
              <div><b>{recon?.coverage.sentinel2Scenes ?? 0}</b><span>S2 SCENES</span></div>
              <div><b>{recon?.coverage.lowCloudScenes ?? 0}</b><span>LOW CLOUD</span></div>
              <div><b>{recon?.coverage.openAerialMapCandidates ?? 0}</b><span>AERIAL</span></div>
            </div>
          </section>

          <section className="ore-panel">
            <div className="ore-panel-title compact"><div><span>OBSERVATION LOG</span><strong>RETURNED SCENES</strong></div><Layers3 size={14} /></div>
            <div className="ore-list">
              {candidates.length === 0 && <div className="ore-empty"><Database size={16} /><span>{queryBusy ? 'Querying scene catalogs…' : 'No qualifying observations returned for this AOI.'}</span></div>}
              {candidates.slice(0, 8).map(candidate => (
                <button type="button" key={candidate.id} className={'ore-log-row ' + (selectedId === candidate.id ? 'selected' : '')} onClick={() => selectCandidate(candidate)}>
                  <div><strong>{missionLabel(candidate)}</strong><span>{candidate.provider}</span></div>
                  <div className="ore-log-meta"><b>{scorePct(candidate)}%</b><span>{candidate.nativeResolutionM ? String(candidate.nativeResolutionM) + 'm' : '—'}</span><ChevronRight size={12} /></div>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="ore-map-wrap">
          <div ref={containerRef} className="ore-map" />
          <div className="ore-map-top">
            <div className="ore-map-badge"><i /> {mapMode === 'normal' ? 'OPERATIONAL SURFACE' : mapMode === 'precision' ? 'DETAIL OBSERVATION' : 'LATEST VALIDATED OBSERVATION'}</div>
            <div className="ore-map-source">{viewed ? sourceLabel(viewed.render?.source) : 'SCENE SEARCH'}</div>
          </div>
          <div className="ore-map-bottom">
            <span><b>ACQ</b> {dateLabel(viewed?.acquiredAt)}</span>
            <span><b>RES</b> {viewed?.nativeResolutionM ? String(viewed.nativeResolutionM) + ' m' : '—'}</span>
            <span><b>CLOUD</b> {viewed?.cloudPct != null ? viewed.cloudPct.toFixed(1) + '%' : '—'}</span>
            <span><b>LICENCE</b> {viewed?.licence || '—'}</span>
          </div>
          <div className="ore-map-controls">
            <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><ZoomIn size={14} /></button>
            <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><ZoomOut size={14} /></button>
          </div>
          {queryBusy && (
            <div className="ore-map-acquire">
              <div className="ore-acquire-ring" />
              <div><strong>ACQUIRING SCENE EVIDENCE</strong><span>Querying current optical catalogs for the active AOI</span></div>
            </div>
          )}
          {opticalQ.error && (
            <div className="ore-map-alert critical">
              <XCircle size={15} />
              <div><strong>SCENE ACQUISITION FAILED</strong><span>The source gateway did not return a certified observation. No stale scene is silently substituted.</span></div>
              <button type="button" onClick={() => opticalQ.refetch()}>RETRY</button>
            </div>
          )}
          {!opticalQ.error && recon?.warnings.length ? (
            <div className="ore-map-alert warn">
              <AlertTriangle size={14} />
              <div><strong>PROVIDER WARNING</strong><span>{recon.warnings.map(value => value.replaceAll('_', ' ')).join(' · ')}</span></div>
            </div>
          ) : null}
        </section>

        <aside className="ore-right">
          <section className="ore-panel ore-integrity">
            <div className="ore-panel-title">
              <div><span>OBSERVATION INTEGRITY</span><strong>{qualityLabel(recon?.quality.state)}</strong></div>
              {state === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            </div>
            <div className="ore-integrity-meter">
              <div className={'fill ' + state} style={{ width: Math.max(4, scorePct(viewed)) + '%' }} />
            </div>
            <div className="ore-integrity-stats">
              <div><span>SELECTION SCORE</span><b>{scorePct(viewed)} / 100</b></div>
              <div><span>FRESHNESS</span><b>{viewed?.freshness || '—'}</b></div>
            </div>
            <p>{viewed?.recommendation || 'The fabric will select the strongest eligible observation as catalog evidence becomes available.'}</p>
          </section>

          <section className="ore-context-grid">
            <div className="ore-panel ore-context-card">
              <div className="ore-context-icon weather"><CloudRain size={14} /></div>
              <span>WEATHER</span>
              <strong>{String(weatherAttrs.conditions || '—').replaceAll('_', ' ')}</strong>
              <small>{weatherAttrs.temperatureC != null ? String(weatherAttrs.temperatureC) + '°C' : 'No current value'}</small>
            </div>
            <div className="ore-panel ore-context-card">
              <div className="ore-context-icon"><Wind size={14} /></div>
              <span>WIND</span>
              <strong>{weatherAttrs.windSpeedKmh != null ? String(weatherAttrs.windSpeedKmh) + ' km/h' : '—'}</strong>
              <small>{weatherAttrs.visibilityM != null ? (Number(weatherAttrs.visibilityM) / 1000).toFixed(1) + ' km visibility' : 'Visibility —'}</small>
            </div>
            <div className="ore-panel ore-context-card">
              <div className="ore-context-icon hazard"><ShieldAlert size={14} /></div>
              <span>HAZARDS</span>
              <strong>{hazardCount}</strong>
              <small>{hazardCount ? 'nearby operational signals' : 'no nearby signals'}</small>
            </div>
            <div className="ore-panel ore-context-card">
              <div className="ore-context-icon security"><Activity size={14} /></div>
              <span>SECURITY</span>
              <strong>{securityCount}</strong>
              <small>{securityCount ? 'context objects' : 'no active objects'}</small>
            </div>
          </section>

          <section className="ore-panel">
            <div className="ore-panel-title compact"><div><span>ACQUISITION RECORD</span><strong>PROVENANCE</strong></div><Clock3 size={14} /></div>
            <div className="ore-record">
              <div><span>MISSION</span><b>{missionLabel(viewed)}</b></div>
              <div><span>PROVIDER</span><b>{viewed?.provider || '—'}</b></div>
              <div><span>ACQUIRED UTC</span><b>{viewed?.acquiredAt || '—'}</b></div>
              <div><span>LICENCE</span><b>{viewed?.licence || '—'}</b></div>
              <div><span>CAPABILITIES</span><b>{viewed?.capabilities?.join(' · ') || '—'}</b></div>
            </div>
          </section>

          <section className="ore-panel">
            <div className="ore-panel-title compact"><div><span>TRUTH MODEL</span><strong>WHAT THIS SCREEN MEANS</strong></div></div>
            <div className="ore-truth"><span>OBSERVED</span><b>Source image + acquisition metadata</b></div>
            <div className="ore-truth"><span>DERIVED</span><b>Freshness, score, cloud and local context</b></div>
            <div className="ore-truth"><span>MODELLED</span><b>Never upgraded into telemetry</b></div>
            <div className="ore-truth emphasis"><span>AUTHORITY</span><b>Live GPS remains the operational source of truth</b></div>
          </section>

          {weather && (
            <section className="ore-panel ore-weather">
              <div className="ore-panel-title compact"><div><span>WEATHER DETAIL</span><strong>LOCAL ENVIRONMENT</strong></div><Thermometer size={14} /></div>
              <div className="ore-weather-grid">
                <div><b>{weatherAttrs.temperatureC != null ? String(weatherAttrs.temperatureC) + '°C' : '—'}</b><span>TEMP</span></div>
                <div><b>{weatherAttrs.humidityPct != null ? String(weatherAttrs.humidityPct) + '%' : '—'}</b><span>HUMIDITY</span></div>
                <div><b>{weatherAttrs.precipitationMm != null ? String(weatherAttrs.precipitationMm) + ' mm' : '—'}</b><span>PRECIP</span></div>
                <div><b>{weatherAttrs.visibilityM != null ? (Number(weatherAttrs.visibilityM) / 1000).toFixed(1) + ' km' : '—'}</b><span>VISIBILITY</span></div>
              </div>
            </section>
          )}

          {degraded && !opticalQ.error && (
            <div className="ore-footer-note"><AlertTriangle size={12} /> Supporting intelligence may be degraded; the imagery evidence and GPS authority remain explicitly separated.</div>
          )}
        </aside>
      </div>
    </div>
  )
}
