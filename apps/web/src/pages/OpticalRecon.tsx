import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, CloudRain, Crosshair, Eye, Layers3, Map as MapIcon,
  Maximize2, RefreshCw, Satellite, ShieldAlert, Thermometer, Wind, ZoomIn, ZoomOut,
} from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../styles/optical-recon.css'
import { STREET_STYLE } from '../lib/mapStyles.js'
import { fetchOpticalRecon, installOpticalReconMapLibreProtocol, reconStyle, type OpticalReconResult } from '../lib/opticalRecon.js'
import { fetchWorldContext, type SpatialWorldContext } from '../lib/spatialClient.js'
import { spatialCanvasContextAttributes, spatialPixelRatio } from '../lib/spatialRendering.js'

installOpticalReconMapLibreProtocol()

type MapMode = 'normal' | 'latest' | 'precision'

function formatAge(value?: string | null) {
  if (!value) return 'UNKNOWN'
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return 'UNKNOWN'
  const hours = Math.max(0, Date.now() - t) / 3600000
  if (hours < 1) return String(Math.max(1, Math.round(hours * 60))) + 'm'
  if (hours < 48) return String(Math.round(hours)) + 'h'
  return String(Math.round(hours / 24)) + 'd'
}

function formatAcquired(value?: string | null) {
  if (!value) return 'Acquisition time unavailable'
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return value
  return new Date(t).toLocaleString([], {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}

function sourceLabel(source?: string) {
  if (source === 'sentinel') return 'Sentinel-2 / DE AFRICA'
  if (source === 'oam') return 'OPENAERIALMAP'
  if (source === 'nasa') return 'NASA GIBS / MODIS'
  return 'UNKNOWN SOURCE'
}

function firstWeather(ctx?: SpatialWorldContext) {
  return ctx?.environment?.find(x => x.entityType === 'weather') ?? ctx?.entities?.find(x => x.entityType === 'weather')
}

export default function OpticalRecon() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const clickMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapMode, setMapMode] = useState<MapMode>('normal')
  const [centre, setCentre] = useState({ latitude: -1.286389, longitude: 36.817223 })
  const [aoiVersion, setAoiVersion] = useState(0)
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const opticalQ = useQuery<OpticalReconResult>({
    queryKey: ['optical-recon-page', centre.latitude, centre.longitude, aoiVersion],
    queryFn: ({ signal }) => fetchOpticalRecon(centre, 35_000, signal),
    enabled: mapReady,
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: 1,
  })

  const worldQ = useQuery<SpatialWorldContext>({
    queryKey: ['optical-recon-world-context', centre.latitude, centre.longitude],
    queryFn: ({ signal }) => fetchWorldContext({
      center: centre, radiusM: 50_000,
      layers: ['weather', 'hazards', 'security', 'incidents'],
      maxEntitiesPerLayer: 50, signal,
    }),
    enabled: mapReady, staleTime: 30_000, refetchInterval: 120_000, retry: 1,
  })

  useEffect(() => {
    if (opticalQ.isError && mapMode !== 'normal') {
      setMapMode('normal')
      setSelectedCandidate(null)
      if (mapRef.current) {
        setMapReady(false)
        mapRef.current.setStyle(STREET_STYLE)
      }
    }
  }, [opticalQ.isError, mapMode])

  const recon = opticalQ.data
  const candidates = useMemo(
    () => (recon?.candidates ?? []).slice().sort((a, b) => Number(b.score) - Number(a.score)),
    [recon],
  )
  const viewedCandidate = useMemo(() => {
    if (!recon) return null
    const selected = candidates.find(candidate => candidate.id === selectedCandidate)
    return selected ?? (mapMode === 'precision' ? recon.precisionAlternative : null) ?? recon.primary
  }, [candidates, mapMode, recon, selectedCandidate])

  useEffect(() => {
    if (!opticalQ.isFetching && isRefreshing) setIsRefreshing(false)
  }, [opticalQ.isFetching, isRefreshing])
  const weather = firstWeather(worldQ.data)
  const weatherAttrs = (weather?.attributes ?? {}) as Record<string, unknown>
  const hazardTotal = (worldQ.data?.hazards ?? []).length + (worldQ.data?.incidents ?? []).length
  const securityTotal = (worldQ.data?.security ?? []).length + (worldQ.data?.operational?.alerts ?? []).length
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STREET_STYLE,
      center: [centre.longitude, centre.latitude],
      zoom: 7,
      attributionControl: false,
      pixelRatio: spatialPixelRatio(),
      maxCanvasSize: [8192, 8192],
      canvasContextAttributes: spatialCanvasContextAttributes,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: false }), 'bottom-right')
    map.on('style.load', () => setMapReady(true))
    map.on('click', event => {
      setCentre({ latitude: event.lngLat.lat, longitude: event.lngLat.lng })
      setAoiVersion(v => v + 1)
      setMapMode('latest')
      clickMarkerRef.current?.remove()
      clickMarkerRef.current = new maplibregl.Marker({ color: '#5eead4', scale: 0.8 }).setLngLat(event.lngLat).addTo(map)
    })
    mapRef.current = map
    return () => {
      clickMarkerRef.current?.remove()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    if (!viewedCandidate?.render || mapMode === 'normal' || !mapRef.current) return
    setMapReady(false)
    mapRef.current.setStyle(reconStyle(viewedCandidate.render))
  }, [mapMode, viewedCandidate?.render?.source, viewedCandidate?.render?.date, viewedCandidate?.render?.itemId])

  const runLatestAtCentre = () => {
    const map = mapRef.current
    if (!map) return
    const c = map.getCenter()
    setCentre({ latitude: c.lat, longitude: c.lng })
    setAoiVersion(v => v + 1)
    setSelectedCandidate(null)
    setIsRefreshing(true)
    setMapMode('latest')
  }

  const returnNormal = () => {
    setSelectedCandidate(null)
    setMapMode('normal')
    if (mapRef.current) {
      setMapReady(false)
      mapRef.current.setStyle(STREET_STYLE)
    }
  }

  return (
    <div className="ore-root">
      <header className="ore-header">
        <div className="ore-brand">
          <div className="ore-mark"><Satellite size={18} /></div>
          <div>
            <div className="ore-eyebrow">SONALIT / SECURITY / EARTH INTELLIGENCE</div>
            <h1>OPTICAL RECON <span>OPEN EARTH</span></h1>
            <p>Latest validated optical observation · open imagery sources · operational evidence, not live telemetry</p>
          </div>
        </div>
        <div className="ore-header-actions">
          <div className="ore-live-readout"><i /> FABRIC <strong>LIVE</strong></div>
          <button className="ore-btn ore-btn-ghost" type="button" onClick={runLatestAtCentre} disabled={isRefreshing}>
            <RefreshCw size={14} className={isRefreshing ? 'ore-spin' : ''} /> REFRESH AOI
          </button>
        </div>
      </header>

      <section className="ore-toolbar">
        <div className="ore-mode-group">
          <button className={mapMode === 'normal' ? 'active' : ''} onClick={returnNormal}><MapIcon size={14} /> NORMAL MAP</button>
          <button className={mapMode === 'latest' ? 'active' : ''} onClick={() => recon ? setMapMode('latest') : runLatestAtCentre()}><Satellite size={14} /> LATEST SATELLITE</button>
          {recon?.precisionAlternative && (
            <button className={mapMode === 'precision' ? 'active precision' : 'precision'} onClick={() => { setSelectedCandidate(recon.precisionAlternative?.id ?? null); setMapMode('precision') }}>
              <Maximize2 size={14} /> HIGH-DETAIL
            </button>
          )}
        </div>
        <div className="ore-coordinates"><Crosshair size={13} /><span>{centre.latitude.toFixed(5)}°</span><span>{centre.longitude.toFixed(5)}°</span><b>AOI 35 KM</b></div>
      </section>

      <main className="ore-grid">
        <section className="ore-map-wrap">
          <div ref={containerRef} className="ore-map" />
          <div className="ore-map-overlay ore-map-top-left">
            <div className="ore-map-label"><span className="ore-status-dot" /> {mapMode === 'normal' ? 'OPERATIONAL MAP' : mapMode === 'precision' ? 'HIGH-DETAIL OPTICAL' : 'LATEST VALIDATED OPTICAL'}</div>
            <div className="ore-map-meta">{viewedCandidate ? sourceLabel(viewedCandidate.render?.source) : opticalQ.isFetching ? 'SEARCHING FREE IMAGERY CATALOGS…' : 'AWAITING AOI SEARCH'}</div>
          </div>
          <div className="ore-map-overlay ore-map-bottom-left">
            <div><span>OBSERVED</span> {viewedCandidate?.nativeResolutionM ? String(viewedCandidate.nativeResolutionM) + ' m native' : '—'}</div>
            <div><span>ACQUIRED</span> {formatAcquired(viewedCandidate?.acquiredAt)}</div>
            <div><span>FRESHNESS</span> {viewedCandidate?.freshness || '—'}</div>
            <div><span>LICENSE</span> {viewedCandidate?.licence || '—'}</div>
            <div><span>ATTRIBUTION</span> {sourceLabel(viewedCandidate?.render?.source)}</div>
          </div>
          <div className="ore-map-controls">
            <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><ZoomIn size={15} /></button>
            <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><ZoomOut size={15} /></button>
          </div>
          {opticalQ.error && (
            <div className="ore-map-error"><AlertTriangle size={15} /><div><strong>IMAGERY SEARCH DEGRADED</strong><span>No silent stale substitution was made.</span></div><button type="button" onClick={() => opticalQ.refetch()}>RETRY</button></div>
          )}
        </section>

        <aside className="ore-sidebar">
          <section className="ore-card ore-hero-card">
            <div className="ore-card-head">
              <div><span className="ore-kicker">{selectedCandidate ? 'VIEWING OBSERVATION' : 'LATEST AVAILABLE'}</span><h2>{viewedCandidate?.mission || 'SEARCHING'}</h2></div>
              <div className="ore-fresh-chip">{viewedCandidate?.freshness || 'PENDING'}</div>
            </div>
            <div className="ore-big-stat"><strong>{viewedCandidate?.nativeResolutionM ? String(viewedCandidate.nativeResolutionM) + ' m' : '—'}</strong><span>NATIVE RESOLUTION</span></div>
            <div className="ore-stat-grid">
              <div><span>ACQUIRED</span><b>{formatAcquired(viewedCandidate?.acquiredAt)}</b></div>
              <div><span>IMAGE AGE</span><b>{formatAge(viewedCandidate?.acquiredAt)}</b></div>
              <div><span>CLOUD</span><b>{viewedCandidate?.cloudPct != null ? viewedCandidate.cloudPct.toFixed(1) + '%' : '—'}</b></div>
              <div><span>SOURCE</span><b>{sourceLabel(viewedCandidate?.render?.source)}</b></div>
            </div>
            <div className="ore-evidence-line"><Eye size={14} /><span>{viewedCandidate?.recommendation || 'Selecting the best free optical evidence for this AOI.'}</span></div>
          </section>

          <section className="ore-mini-grid">
            <div className="ore-card ore-mini-card"><div className="ore-mini-icon weather"><CloudRain size={15} /></div><span>WEATHER</span><strong>{String(weatherAttrs.conditions || '—').replaceAll('_', ' ')}</strong><small>{weatherAttrs.temperatureC != null ? String(weatherAttrs.temperatureC) + '°C' : 'No current value'}</small></div>
            <div className="ore-card ore-mini-card"><div className="ore-mini-icon"><Wind size={15} /></div><span>WIND</span><strong>{weatherAttrs.windSpeedKmh != null ? String(weatherAttrs.windSpeedKmh) + ' km/h' : '—'}</strong><small>{weatherAttrs.visibilityM != null ? String(Math.round(Number(weatherAttrs.visibilityM) / 1000)) + ' km vis' : 'Visibility —'}</small></div>
            <div className="ore-card ore-mini-card"><div className="ore-mini-icon"><ShieldAlert size={15} /></div><span>HAZARDS</span><strong>{hazardTotal}</strong><small>{hazardTotal ? 'signals nearby' : 'no nearby signals'}</small></div>
            <div className="ore-card ore-mini-card"><div className="ore-mini-icon"><Activity size={15} /></div><span>SECURITY</span><strong>{securityTotal}</strong><small>{securityTotal ? 'security objects' : 'no active objects'}</small></div>
          </section>

          {weather && (
            <section className="ore-card">
              <div className="ore-card-head compact"><div><span className="ore-kicker">MICRO WEATHER</span><h3>NOW AROUND AOI</h3></div><Thermometer size={15} /></div>
              <div className="ore-weather-row">
                <div><b>{weatherAttrs.temperatureC != null ? String(weatherAttrs.temperatureC) + '°C' : '—'}</b><span>TEMP</span></div>
                <div><b>{weatherAttrs.humidityPct != null ? String(weatherAttrs.humidityPct) + '%' : '—'}</b><span>HUMIDITY</span></div>
                <div><b>{weatherAttrs.precipitationMm != null ? String(weatherAttrs.precipitationMm) + ' mm' : '—'}</b><span>PRECIP</span></div>
                <div><b>{weatherAttrs.visibilityM != null ? (Number(weatherAttrs.visibilityM) / 1000).toFixed(1) + ' km' : '—'}</b><span>VIS</span></div>
              </div>
              {Array.isArray(weatherAttrs.hazards) && weatherAttrs.hazards.length > 0 && <div className="ore-hazard-strip"><AlertTriangle size={13} /> {weatherAttrs.hazards.map(String).join(' · ')}</div>}
            </section>
          )}

          <section className="ore-card ore-candidates">
            <div className="ore-card-head compact"><div><span className="ore-kicker">EVIDENCE CATALOG</span><h3>AVAILABLE OBSERVATIONS</h3></div><Layers3 size={15} /></div>
            <div className="ore-candidate-list">
              {candidates.length === 0 && <div className="ore-empty">No qualifying observations returned for this AOI.</div>}
              {candidates.map(candidate => (
                <button
                  type="button"
                  className={'ore-candidate ' + (selectedCandidate === candidate.id ? 'selected' : '')}
                  key={candidate.id}
                  onClick={() => {
                    setSelectedCandidate(candidate.id)
                    if (candidate.render) setMapMode(candidate.render.source === 'oam' ? 'precision' : 'latest')
                  }}
                >
                  <div className="ore-candidate-main"><strong>{candidate.mission}</strong><span>{candidate.provider}</span></div>
                  <div className="ore-candidate-meta"><b>{candidate.nativeResolutionM ? String(candidate.nativeResolutionM) + ' m' : '—'}</b><span>{candidate.cloudPct != null ? candidate.cloudPct.toFixed(0) + '% cloud' : 'cloud —'}</span><span>{formatAge(candidate.acquiredAt)} old</span></div>
                </button>
              ))}
            </div>
          </section>

          <section className="ore-card ore-truth">
            <div className="ore-card-head compact"><div><span className="ore-kicker">EVIDENCE DISCIPLINE</span><h3>WHAT SONALIT KNOWS</h3></div></div>
            <div className="ore-truth-row"><span>OBSERVED</span><b>Acquisition metadata + image</b></div>
            <div className="ore-truth-row"><span>DERIVED</span><b>Freshness, cloud and operational context</b></div>
            <div className="ore-truth-row"><span>MODELLED</span><b>Never presented as telemetry</b></div>
            <div className="ore-truth-row warning"><span>AUTHORITY</span><b>Operational GPS remains authoritative</b></div>
          </section>
        </aside>
      </main>
    </div>
  )
}
