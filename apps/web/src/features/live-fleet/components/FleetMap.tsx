import { spatialPixelRatio, spatialCanvasContextAttributes } from '../../../lib/spatialRendering.js'
import { STREET_STYLE } from '../../../lib/mapStyles.js'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../../../lib/api.js'
import {
  trafficTransformRequest, addTrafficLayers, setTrafficLayersVisible, setTrafficIncidents,
  bboxFromMap, useTrafficIncidents, useTrafficStatus,
} from '../../../lib/trafficLayer.js'
import { trafficAvailabilityNotice } from '../../../lib/trafficHealth.js'
import type { LiveVehicle, LiveStatus } from '../types/fleet.js'
import '../../../styles/spatial-command.css'

installOpticalReconMapLibreProtocol()
import { externalWorldFeatures, fetchWorldContext, WORLD_CONTEXT_LAYERS } from '../../../lib/spatialClient.js'
import { fetchOpticalRecon, installOpticalReconMapLibreProtocol, reconStyle, type OpticalReconResult } from '../../../lib/opticalRecon.js'

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['sonalit-ai://satellite/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri, Maxar, GeoEye, Earthstar Geographics',
    },
    ref: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'sat-layer', type: 'raster', source: 'sat' },
    { id: 'ref-layer', type: 'raster', source: 'ref' },
  ],
}

const EARTH_OBSERVATION_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    earth: {
      type: 'raster',
      tiles: ['sonalit-ai://earth/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 9,
      attribution: 'NASA EOSDIS GIBS',
    },
  },
  layers: [{ id: 'earth-layer', type: 'raster', source: 'earth' }],
}

const STATUS_COLOR: Record<LiveStatus, string> = {
  move: '#16c784', idle: '#f59e0b', stop: '#475569', offline: '#3e4252', sos: '#ef4444',
}

interface Geofence {
  id: string; name: string; type: string
  coordinates: unknown
  radius: number | null; lat: number | null; lng: number | null
}
interface RiskZone {
  h3_index: string; name: string; risk_level: string
  center_lat: number; center_lon: number; radius_km: number
}

type GeoRing = [number, number][]
type GeoFC = {
  type: 'FeatureCollection'
  features: Array<{ type: 'Feature'; geometry: { type: 'Polygon'; coordinates: GeoRing[] }; properties: Record<string, string> }>
}

function circlePolygon(lat: number, lng: number, radiusM: number): GeoRing {
  const pts = 48; const out: GeoRing = []
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * 2 * Math.PI
    const dLat = (radiusM * Math.sin(a) / 6371000) * (180 / Math.PI)
    const dLng = (radiusM * Math.cos(a) / 6371000) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180)
    out.push([lng + dLng, lat + dLat])
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coordsToPoints(c: any): [number, number][] | null {
  if (!c) return null
  if (typeof c === 'string') { try { return coordsToPoints(JSON.parse(c)) } catch { return null } }
  if (typeof c === 'object' && !Array.isArray(c)) {
    if (Array.isArray(c.coordinates)) return coordsToPoints(c.coordinates)
    // OSRM corridor: {path:[[lat,lng],...]} — swap axes to [lng,lat]
    if (Array.isArray(c.path)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pts = (c.path as any[]).map((p: any) => Array.isArray(p) ? [Number(p[1]), Number(p[0])] as [number, number] : null).filter((p): p is [number, number] => p !== null)
      return pts.length >= 2 ? pts : null
    }
    return null
  }
  if (!Array.isArray(c) || c.length < 2) return null
  if (Array.isArray(c[0]) && Array.isArray((c[0] as unknown[])[0])) return coordsToPoints(c[0])
  if (Array.isArray(c[0])) return (c as number[][]).map(p => [Number(p[0]), Number(p[1])] as [number, number])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (c as any[]).map(p => [p.lng ?? p.longitude ?? 0, p.lat ?? p.latitude ?? 0] as [number, number])
}

function isCorridor(g: Geofence): boolean {
  const t = (g.type ?? '').toLowerCase()
  return t === 'corridor' || t === 'linear' || t === 'line' || t === 'linestring' || t === 'route'
}


function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function spatialRadiusFromMap(map: maplibregl.Map): number {
  const center = map.getCenter()
  const bounds = map.getBounds()
  const corners = [bounds.getNorthEast(), bounds.getNorthWest(), bounds.getSouthEast(), bounds.getSouthWest()]
  const radius = Math.max(...corners.map(p => distanceMeters(center.lat, center.lng, p.lat, p.lng))) * 1.15
  return Math.min(100000, Math.max(15000, Number.isFinite(radius) ? radius : 25000))
}

function buildRiskFC(zones: RiskZone[]): GeoFC {
  return { type: 'FeatureCollection', features: zones.filter(z => z.center_lat && z.center_lon).map(z => ({
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(z.center_lat, z.center_lon, z.radius_km * 1000)] },
    properties: { id: z.h3_index, name: z.name, risk_level: z.risk_level },
  }))}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const riskColorExpr: any = ['case',
  ['==', ['get', 'risk_level'], 'high'],   '#ef4444',
  ['==', ['get', 'risk_level'], 'medium'], '#f97316',
  '#eab308',
]

// Field officer (Guardian device) marker glyph — a person icon inside a
// rounded-square badge, distinct from the plain dot used for vehicles so the
// two are never confused at a glance on a busy map.
const OFFICER_ICON = (color: string) =>
  `<svg width="11" height="11" viewBox="0 0 24 24" fill="${color}" stroke="none" style="pointer-events:none">
     <circle cx="12" cy="7.5" r="4.2"/>
     <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
   </svg>`

function makeEl(v: LiveVehicle): HTMLElement {
  const isOfficer = v.kind === 'guardian'
  // For a field officer, "online at all" is the signal that matters most —
  // whether they're walking, stopped, or idle is secondary to dispatch
  // knowing their device is actually reachable right now. So online officers
  // glow green regardless of move/idle/stop sub-state; SOS and offline still
  // take priority over that.
  const color = (isOfficer && v.status !== 'offline' && v.status !== 'sos') ? '#16c784' : STATUS_COLOR[v.status]
  const spd = Math.round(v.speed_kmh)
  const reg = v.registration.length > 10 ? v.registration.slice(0, 10) : v.registration
  const label = v.status === 'sos' ? 'SOS' : isOfficer && v.status !== 'offline' ? (v.status === 'move' ? `${spd} km/h` : 'ONLINE') : v.status === 'move' ? `${spd} km/h` : v.status === 'offline' ? 'OFF' : v.status.toUpperCase().slice(0, 4)
  const pulse = (v.status === 'move' || v.status === 'idle')
    ? `<div style="position:absolute;inset:-6px;border-radius:${isOfficer ? '7px' : '50%'};border:1.5px solid ${color}55;animation:lf-mping 2.2s ease-out infinite;pointer-events:none"></div>` : ''
  const sos = v.status === 'sos'
    ? `<div style="position:absolute;inset:-7px;border-radius:${isOfficer ? '8px' : '50%'};border:2px solid ${color}88;animation:lf-sos-ring .65s ease-in-out infinite;pointer-events:none"></div>` : ''
  const glyph = isOfficer ? OFFICER_ICON(color) : `<div style="width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 5px ${color};pointer-events:none"></div>`
  // Heading arrow — only for a moving officer with a real bearing. Sits just
  // outside the badge, rotated to point the direction they're travelling
  // (heading is a compass bearing, clockwise from north — same convention
  // CSS rotate() uses, so no sign flip needed).
  const arrow = (isOfficer && v.status === 'move' && v.heading != null)
    ? `<div style="position:absolute;left:50%;top:50%;width:0;height:0;transform:translate(-50%,-50%) rotate(${v.heading}deg) translateY(-17px);border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${color};filter:drop-shadow(0 0 3px ${color}aa);pointer-events:none"></div>`
    : ''
  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none">
      <div style="position:relative;overflow:visible;width:22px;height:22px;border-radius:${isOfficer ? '6px' : '50%'};background:rgba(5,7,13,.92);border:2px solid ${color};display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px ${color}44,0 2px 8px rgba(0,0,0,.8);pointer-events:all;cursor:pointer;${v.status==='sos'?'animation:lf-sos-marker .65s ease-in-out infinite':''}">
        ${pulse}${sos}${arrow}
        ${glyph}
      </div>
      <div style="display:flex;gap:3px;align-items:center;background:rgba(5,7,13,.95);border:1px solid ${color}44;border-radius:3px;padding:1px 6px;pointer-events:none;white-space:nowrap">
        <span style="font-family:JetBrains Mono,IBM Plex Mono,monospace;font-size:9px;font-weight:700;color:#e8a830">${reg}</span>
        <span style="font-family:JetBrains Mono,IBM Plex Mono,monospace;font-size:8px;color:${color};font-weight:600">${label}</span>
      </div>
    </div>`
  return wrap
}

interface Props { vehicles: LiveVehicle[]; selectedId: string | null; onSelect: (v: LiveVehicle) => void; trackedId?: string | null }

export default function FleetMap({ vehicles, selectedId, onSelect, trackedId = null }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const coordsRef = useRef<HTMLSpanElement>(null)
  const animRef = useRef(0)
  const [mapReady, setMapReady] = useState(false)
  const [mapMode, setMapMode] = useState<'dark' | 'satellite' | 'earth' | 'latest'>('dark')
  const [trafficOn, setTrafficOn] = useState(false)
  const [reconLoading, setReconLoading] = useState(false)
  const appliedReconKeyRef = useRef('')
  const [worldSpatialOn, setWorldSpatialOn] = useState(true)
  const [bbox, setBbox] = useState<string | null>(null)
  const [worldViewport, setWorldViewport] = useState<{ latitude: number; longitude: number; radiusM: number } | null>(null)

  const { data: trafficStatus } = useTrafficStatus()
  const { data: trafficFC, isError: trafficIncidentsError } = useTrafficIncidents(bbox, trafficOn)
  const trafficNotice = trafficOn ? trafficAvailabilityNotice(trafficIncidentsError, trafficFC?.health?.status) : null

  const { data: worldContext, isFetching: worldFetching, isError: worldError } = useQuery({
    queryKey: ['gps-world-context', worldViewport?.latitude, worldViewport?.longitude, worldViewport?.radiusM],
    queryFn: ({ signal }) => fetchWorldContext({
      center: { latitude: worldViewport!.latitude, longitude: worldViewport!.longitude },
      radiusM: worldViewport!.radiusM,
      layers: [...WORLD_CONTEXT_LAYERS],
      maxEntitiesPerLayer: 75,
      signal,
    }),
    enabled: mapReady && worldSpatialOn && !!worldViewport,
    staleTime: 10000,
    refetchInterval: 30000,
    retry: 1,
  })

  const { data: geofences } = useQuery<Geofence[]>({
    queryKey: ['live-fleet-geofences'],
    queryFn: async () => { const r = await api.get<{ data: Geofence[] }>('/geofences'); return r.data.data ?? [] },
    staleTime: 120_000, refetchInterval: 120_000,
  })
  const { data: riskZones } = useQuery<RiskZone[]>({
    queryKey: ['live-fleet-riskzones'],
    queryFn: async () => { const r = await api.get<{ data: RiskZone[] }>('/riskzones'); return r.data.data ?? [] },
    staleTime: 60_000, refetchInterval: 60_000,
  })

  // init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const m = new maplibregl.Map({ container: containerRef.current, style: STREET_STYLE, center: [35.5, 1.2], zoom: 5, attributionControl: false, pixelRatio: spatialPixelRatio(), maxCanvasSize: [8192, 8192], canvasContextAttributes: spatialCanvasContextAttributes, transformRequest: trafficTransformRequest })
    m.on('style.load', () => {
      setMapReady(true)
      syncWorldViewport()
    })
    m.on('mousemove', e => {
      if (!coordsRef.current) return
      const { lat, lng } = e.lngLat
      coordsRef.current.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`
    })
    const syncWorldViewport = () => {
      const center = m.getCenter()
      setWorldViewport({ latitude: center.lat, longitude: center.lng, radiusM: spatialRadiusFromMap(m) })
    }
    m.on('moveend', () => {
      setBbox(bboxFromMap(m))
      syncWorldViewport()
    })
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null; setMapReady(false) }
  }, [])

  const reconCentre = worldViewport
    ? { latitude: worldViewport.latitude, longitude: worldViewport.longitude }
    : null

  const { data: opticalRecon, isFetching: opticalReconFetching, isError: opticalReconError } = useQuery<OpticalReconResult>({
    queryKey: ['live-fleet-optical-recon', reconCentre?.latitude, reconCentre?.longitude],
    queryFn: ({ signal }) => fetchOpticalRecon(
      reconCentre!,
      Math.min(worldViewport?.radiusM ?? 25_000, 120_000),
      signal,
    ),
    enabled: mapReady && mapMode === 'latest' && !!reconCentre,
    staleTime: 60_000,
    refetchInterval: 300_000,
    retry: 1,
  })

  useEffect(() => {
    if (!opticalReconFetching) setReconLoading(false)
    if (mapMode === 'latest' && opticalReconError && mapRef.current) {
      appliedReconKeyRef.current = ''
      setMapMode('dark')
      setMapReady(false)
      mapRef.current.setStyle(STREET_STYLE)
    }
  }, [opticalReconFetching, opticalReconError, mapMode])

  const cycleMapMode = () => {
    const map = mapRef.current; if (!map) return
    const next = mapMode === 'dark' ? 'satellite' : mapMode === 'satellite' ? 'earth' : 'dark'
    setMapReady(false)
    appliedReconKeyRef.current = ''
    setMapMode(next)
    map.setStyle(next === 'dark' ? STREET_STYLE : next === 'satellite' ? SATELLITE_STYLE : EARTH_OBSERVATION_STYLE)
  }

  const activateLatestImagery = () => {
    const map = mapRef.current
    if (!map || !opticalRecon?.render) {
      setMapMode('latest')
      setReconLoading(true)
      return
    }
    setReconLoading(false)
    setMapReady(false)
    appliedReconKeyRef.current = ''
    setMapMode('latest')
    map.setStyle(reconStyle(opticalRecon.render))
  }

  useEffect(() => {
    if (mapMode !== 'latest' || !opticalRecon?.render || !mapRef.current) return
    const render = opticalRecon.render
    const key = [render.source, render.date || '', render.itemId || ''].join('|')
    if (appliedReconKeyRef.current === key) return
    appliedReconKeyRef.current = key
    setReconLoading(false)
    setMapReady(false)
    mapRef.current.setStyle(reconStyle(render))
  }, [mapMode, opticalRecon])

  // geofence overlay — polygon zones + corridor/linear routes
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    const polyFeats: Array<{ type: 'Feature'; geometry: { type: 'Polygon'; coordinates: [number, number][][] }; properties: { id: string; name: string } }> = []
    const lineFeats: Array<{ type: 'Feature'; geometry: { type: 'LineString'; coordinates: [number, number][] }; properties: { id: string; name: string } }> = []

    for (const g of (geofences ?? [])) {
      const pts = coordsToPoints(g.coordinates)
      if (!pts?.length) continue
      const props = { id: g.id, name: g.name }
      if (isCorridor(g)) {
        lineFeats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: props })
      } else {
        const first = pts[0]!; const last = pts[pts.length - 1]!
        const ring = (first[0] === last[0] && first[1] === last[1]) ? pts : [...pts, first]
        polyFeats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const polySrc = map.getSource('gf-polys') as any
    if (polySrc) { polySrc.setData({ type: 'FeatureCollection', features: polyFeats }) }
    else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.addSource('gf-polys', { type: 'geojson', data: { type: 'FeatureCollection', features: polyFeats } } as any)
      map.addLayer({ id: 'gf-poly-fill', type: 'fill', source: 'gf-polys', paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'gf-poly-line', type: 'line', source: 'gf-polys', paint: { 'line-color': '#22d3ee', 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [5, 3] } })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineSrc = map.getSource('gf-lines') as any
    if (lineSrc) { lineSrc.setData({ type: 'FeatureCollection', features: lineFeats }) }
    else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.addSource('gf-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeats } } as any)
      map.addLayer({ id: 'gf-line-buffer', type: 'line', source: 'gf-lines', paint: { 'line-color': '#22d3ee', 'line-width': 16, 'line-opacity': 0.12 } })
      map.addLayer({ id: 'gf-line-center', type: 'line', source: 'gf-lines', paint: { 'line-color': '#22d3ee', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [6, 3] } })
    }
  }, [mapReady, geofences])

  // traffic overlay — added once per style load (satellite toggle wipes and
  // re-triggers mapReady, same as the geofence/risk-zone overlays above)
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    addTrafficLayers(map, trafficOn)
    setBbox(bboxFromMap(map))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady])

  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    setTrafficLayersVisible(map, trafficOn)
  }, [trafficOn, mapReady])

  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    if (trafficIncidentsError) {
      setTrafficIncidents(map, { type: 'FeatureCollection', features: [] })
      return
    }
    if (!trafficFC) return
    setTrafficIncidents(map, trafficFC)
  }, [trafficFC, trafficIncidentsError, mapReady])

  // risk zone overlay
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    const fc = buildRiskFC(riskZones ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = map.getSource('riskzones') as any
    if (src) { src.setData(fc); return }
    if (!fc.features.length) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.addSource('riskzones', { type: 'geojson', data: fc } as any)
    // outer glow (animated via RAF)
    map.addLayer({ id: 'rz-glow', type: 'fill', source: 'riskzones', paint: { 'fill-color': riskColorExpr, 'fill-opacity': 0.15 } })
    // inner fill
    map.addLayer({ id: 'rz-fill', type: 'fill', source: 'riskzones', paint: { 'fill-color': riskColorExpr, 'fill-opacity': 0.2 } })
    // border
    map.addLayer({ id: 'rz-line', type: 'line', source: 'riskzones', paint: { 'line-color': riskColorExpr, 'line-width': 2.5, 'line-opacity': 1 } })
  }, [mapReady, riskZones])


  // XD external-signal treatment: every signal gets a restrained atmospheric
  // underlay plus a crisp core. Geometry remains geometry; styling never upgrades
  // modelled orbital positions into telemetry or acquisition claims.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const sourceId = 'spatial-world'
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    const empty = { type: 'FeatureCollection' as const, features: [] }
    const data = worldSpatialOn ? externalWorldFeatures(worldContext) : empty
    if (source) {
      source.setData(data)
      return
    }
    map.addSource(sourceId, { type: 'geojson', data })
    map.addLayer({
      id: 'spatial-world-glow',
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 10, 7, 15, 12, 22],
        'circle-color': ['match', ['get', 'kind'],
          'satellite', '#c4b5fd',
          'spatial_camera', '#5eead4',
          'camera', '#5eead4',
          'aircraft', '#60a5fa',
          'vessel', '#22d3ee',
          'natural_hazard', '#ef4444',
          'traffic_incident', '#f59e0b',
          'traffic_hazard', '#f97316',
          'traffic_segment', '#eab308',
          'weather', '#a7f3d0',
          'incident', '#fb7185',
          'alert', '#f0abfc',
          'risk_zone', '#f87171',
          'checkpoint', '#34d399',
          'shipment_location', '#67e8f9',
          'security', '#fb923c',
          'infrastructure', '#cbd5e1',
          '#94a3b8',
        ],
        'circle-opacity': ['match', ['get', 'kind'],
          'satellite', 0.13,
          'spatial_camera', 0.12,
          'camera', 0.12,
          0.08,
        ],
        'circle-blur': 1,
      },
    })
    map.addLayer({
      id: 'spatial-world-points',
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3.2, 7, 5.2, 12, 7.5],
        'circle-color': ['match', ['get', 'kind'],
          'satellite', '#c4b5fd',
          'spatial_camera', '#5eead4',
          'camera', '#5eead4',
          'aircraft', '#60a5fa',
          'vessel', '#22d3ee',
          'natural_hazard', '#ef4444',
          'traffic_incident', '#f59e0b',
          'traffic_hazard', '#f97316',
          'traffic_segment', '#eab308',
          'weather', '#a7f3d0',
          'incident', '#fb7185',
          'alert', '#f0abfc',
          'risk_zone', '#f87171',
          'checkpoint', '#34d399',
          'shipment_location', '#67e8f9',
          'security', '#fb923c',
          'infrastructure', '#cbd5e1',
          '#94a3b8',
        ],
        'circle-opacity': ['match', ['get', 'freshness'],
          'LIVE', 0.95,
          'DELAYED', 0.75,
          'STALE', 0.45,
          'MODELLED', 0.38,
          0.55,
        ],
        'circle-stroke-color': ['match', ['get', 'kind'],
          'satellite', '#7c6ee6',
          'spatial_camera', '#2dd4bf',
          'camera', '#2dd4bf',
          'aircraft', '#172554',
          'vessel', '#083344',
          'natural_hazard', '#450a0a',
          'traffic_incident', '#451a03',
          'traffic_hazard', '#431407',
          'traffic_segment', '#422006',
          'weather', '#064e3b',
          'incident', '#4c0519',
          'alert', '#4a044e',
          'risk_zone', '#450a0a',
          'checkpoint', '#064e3b',
          'shipment_location', '#083344',
          'security', '#431407',
          'infrastructure', '#1e293b',
          '#0b1020',
        ],
        'circle-stroke-width': ['match', ['get', 'kind'], 'satellite', 1.25, 'spatial_camera', 1.5, 'camera', 1.5, 1.35],
      },
    })
    map.addLayer({
      id: 'spatial-world-labels',
      type: 'symbol',
      source: sourceId,
      minzoom: 7,
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 10,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ['match', ['get', 'kind'],
          'satellite', '#ddd6fe',
          'spatial_camera', '#99f6e4',
          'camera', '#99f6e4',
          '#dbeafe',
        ],
        'text-halo-color': '#05070d',
        'text-halo-width': 1.25,
      },
    })
  }, [mapReady, worldContext, worldSpatialOn])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer('spatial-world-points')) return
    map.setLayoutProperty('spatial-world-points', 'visibility', worldSpatialOn ? 'visible' : 'none')
    map.setLayoutProperty('spatial-world-labels', 'visibility', worldSpatialOn ? 'visible' : 'none')
  }, [mapReady, worldSpatialOn])

  // pulse animation on high-risk zones
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    let t = 0
    const loop = () => {
      const p = 0.08 + 0.18 * (0.5 + 0.5 * Math.sin(t)); t += 0.04
      try { if (map.getLayer('rz-glow')) map.setPaintProperty('rz-glow', 'fill-opacity', p) } catch (_) {}
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [mapReady])

  // sync vehicle markers
  useEffect(() => {
    const map = mapRef.current; if (!map) return
    const positioned = vehicles.filter(v => v.lat != null && v.lng != null)
    const ids = new Set(positioned.map(v => v.id))
    for (const [id, marker] of markersRef.current) {
      if (!ids.has(id)) { marker.remove(); markersRef.current.delete(id) }
    }
    // Live markers must stack above dead ones: a retired/offline duplicate of
    // the same device often sits at almost the same coordinates as the live
    // row, and if it renders on top the operator sees (and taps) OFFLINE while
    // the online marker hides underneath.
    const zFor = (s: string) => (s === 'sos' ? '40' : s === 'move' ? '30' : s === 'offline' ? '10' : '20')
    for (const v of positioned) {
      const existing = markersRef.current.get(v.id)
      if (existing) {
        existing.setLngLat([v.lng!, v.lat!])
        const el = existing.getElement(); el.innerHTML = makeEl(v).innerHTML
        el.style.zIndex = zFor(v.status)
        const inner = el.firstElementChild as HTMLElement | null
        if (inner) inner.addEventListener('click', e => { e.stopPropagation(); onSelect(v) }, { once: true })
      } else {
        const el = makeEl(v)
        el.style.zIndex = zFor(v.status)
        const inner = el.firstElementChild as HTMLElement | null
        if (inner) inner.addEventListener('click', e => { e.stopPropagation(); onSelect(v) })
        const marker = new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([v.lng!, v.lat!]).addTo(map)
        markersRef.current.set(v.id, marker)
      }
    }
  }, [vehicles, onSelect])

  // fly to selected (one-shot, when selection changes)
  useEffect(() => {
    const map = mapRef.current; if (!map || !selectedId) return
    const v = vehicles.find(x => x.id === selectedId)
    if (v?.lat != null) map.flyTo({ center: [v.lng!, v.lat!], zoom: Math.max(map.getZoom(), 9), duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // follow mode ("Track" action) — keep the camera glued to the tracked
  // vehicle/device as new positions stream in, until the operator toggles off.
  useEffect(() => {
    const map = mapRef.current; if (!map || !trackedId) return
    const v = vehicles.find(x => x.id === trackedId)
    if (v?.lat != null) map.easeTo({ center: [v.lng!, v.lat!], zoom: Math.max(map.getZoom(), 12), duration: 600 })
  }, [trackedId, vehicles])

  // keyframes
  useEffect(() => {
    if (document.getElementById('lf-map-styles')) return
    const s = document.createElement('style'); s.id = 'lf-map-styles'
    s.textContent = `
      @keyframes lf-mping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.2);opacity:0}}
      @keyframes lf-sos-ring{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.5);opacity:.2}}
      @keyframes lf-recon-spin{to{transform:rotate(360deg)}}
      @keyframes lf-sos-marker{0%,100%{box-shadow:0 0 12px #ef444466,0 2px 8px rgba(0,0,0,.8)}50%{box-shadow:0 0 24px #ef4444cc,0 2px 8px rgba(0,0,0,.8)}}
    `
    document.head.appendChild(s)
  }, [])

  const geoCount = geofences?.length ?? 0
  const riskCount = riskZones?.length ?? 0

  return (
    <div className="spatial-map-surface" data-spatial-surface="fleet-2d" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#05070d' }} />

      {/* top-right controls */}
      <div className="spatial-control-rail" style={{ position: 'absolute', right: 14, top: 14, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          onClick={() => setWorldSpatialOn(v => !v)}
          title={worldSpatialOn ? 'Hide external world intelligence' : 'Show external world intelligence'}
          aria-label={worldSpatialOn ? 'Hide external world intelligence' : 'Show external world intelligence'}
          style={{ width: 34, height: 34, borderRadius: 9, background: worldSpatialOn ? 'rgba(196,181,253,.15)' : 'rgba(8,11,20,.92)', border: `1px solid ${worldSpatialOn ? 'rgba(196,181,253,.58)' : 'rgba(255,255,255,.11)'}`, color: worldSpatialOn ? '#c4b5fd' : '#7a7e8a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: worldSpatialOn ? '0 0 18px rgba(196,181,253,.16), inset 0 0 12px rgba(196,181,253,.06)' : 'none', transition: 'all .18s ease' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
        </button>
        {/* traffic toggle — hidden entirely if no TOMTOM_API_KEY is configured server-side */}
        {trafficStatus?.configured && (
          <>
          <button
            onClick={() => setTrafficOn(v => !v)}
            title={trafficOn ? 'Hide traffic (congestion + incidents)' : 'Show traffic (congestion + incidents) — coverage is sparse or absent in some conflict corridors'}
            style={{ width: 34, height: 34, borderRadius: 7, background: trafficOn ? 'rgba(239,68,68,.18)' : 'rgba(8,11,20,.92)', border: `1px solid ${trafficOn ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.11)'}`, color: trafficOn ? '#ef4444' : '#7a7e8a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="20" rx="1"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>
          </button>
          {trafficOn && trafficNotice && (
            <span role="status" aria-live="polite" title={trafficNotice} style={{ color: '#fbbf24', fontSize: 9, maxWidth: 160, textAlign: 'center' }}>
              ROAD STATE UNKNOWN
            </span>
          )}
          </>
        )}
        {/* dedicated latest-optical control: normal map remains one click away */}
        <button
          onClick={() => mapMode === 'latest' ? cycleMapMode() : activateLatestImagery()}
          title={mapMode === 'latest' ? 'Return to normal map' : 'Latest validated satellite observation'}
          aria-label={mapMode === 'latest' ? 'Return to normal map' : 'Latest satellite imagery'}
          style={{
            width: 34, height: 34, borderRadius: 7,
            background: mapMode === 'latest' ? 'rgba(45,212,191,.18)' : 'rgba(8,11,20,.92)',
            border: mapMode === 'latest' ? '1px solid rgba(45,212,191,.72)' : '1px solid rgba(255,255,255,.11)',
            color: mapMode === 'latest' ? '#5eead4' : '#7a7e8a',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
          {reconLoading && <span style={{ position: 'absolute', inset: 2, border: '2px solid rgba(94,234,212,.18)', borderTopColor: '#5eead4', borderRadius: '50%', animation: 'lf-recon-spin .9s linear infinite' }} />}
        </button>
        {/* base-layer cycle: operational map → reference satellite → NASA Earth observation */}
        <button
          onClick={cycleMapMode}
          title={mapMode === 'dark' ? 'Reference satellite' : mapMode === 'satellite' ? 'Earth observation' : 'Normal map'}
          style={{
            width: 34, height: 34, borderRadius: 7,
            background: mapMode !== 'dark' && mapMode !== 'latest' ? 'rgba(232,168,48,.18)' : 'rgba(8,11,20,.92)',
            border: mapMode !== 'dark' && mapMode !== 'latest' ? '1px solid rgba(232,168,48,.6)' : '1px solid rgba(255,255,255,.11)',
            color: mapMode !== 'dark' && mapMode !== 'latest' ? '#e8a830' : '#7a7e8a',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
        </button>
        {/* zoom in */}
        <button onClick={() => mapRef.current?.zoomIn()} style={{ width: 34, height: 34, borderRadius: 7, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.11)', color: '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
        {/* zoom out */}
        <button onClick={() => mapRef.current?.zoomOut()} style={{ width: 34, height: 34, borderRadius: 7, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.11)', color: '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
        {/* fit all */}
        <button onClick={() => {
          const p = vehicles.filter(v => v.lat != null); if (!p.length || !mapRef.current) return
          const lngs = p.map(v => v.lng!); const lats = p.map(v => v.lat!)
          mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: 8 })
        }} style={{ width: 34, height: 34, borderRadius: 7, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.11)', color: '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⊕</button>
      </div>

      {/* coords */}
      <div className="spatial-coordinate" style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 500, background: 'rgba(8,11,20,.64)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 7, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, backdropFilter: 'blur(10px)', boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8f96a3" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span ref={coordsRef} style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 8.5, color: '#8f96a3' }}>hover for coords</span>
      </div>
    </div>
  )
}
