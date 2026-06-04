import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../../../lib/api.js'
import type { LiveVehicle, LiveStatus } from '../types/fleet.js'

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
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
function extractRing(c: any): GeoRing | null {
  if (!c) return null
  if (Array.isArray(c) && Array.isArray(c[0])) return c as GeoRing
  if (c.type === 'Polygon') return c.coordinates?.[0] ?? null
  if (c.type === 'MultiPolygon') return c.coordinates?.[0]?.[0] ?? null
  if (c.type === 'Feature') return extractRing(c.geometry)
  if (c.type === 'FeatureCollection') { for (const f of c.features) { const r = extractRing(f.geometry); if (r) return r } }
  return null
}

function buildGeoFC(items: Geofence[]): GeoFC {
  return { type: 'FeatureCollection', features: items.flatMap(g => {
    let ring = extractRing(g.coordinates)
    // circle-type geofences: radius stored in metres
    if (!ring && g.lat != null && g.lng != null && g.radius != null && g.radius > 0) {
      ring = circlePolygon(g.lat, g.lng, g.radius)
    }
    return ring?.length ? [{ type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [ring] }, properties: { id: g.id, name: g.name } }] : []
  })}
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

function makeEl(v: LiveVehicle): HTMLElement {
  const color = STATUS_COLOR[v.status]
  const spd = Math.round(v.speed_kmh)
  const reg = v.registration.length > 10 ? v.registration.slice(0, 10) : v.registration
  const label = v.status === 'sos' ? 'SOS' : v.status === 'move' ? `${spd} km/h` : v.status === 'offline' ? 'OFF' : v.status.toUpperCase().slice(0, 4)
  const pulse = (v.status === 'move' || v.status === 'idle')
    ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:1.5px solid ${color}55;animation:lf-mping 2.2s ease-out infinite;pointer-events:none"></div>` : ''
  const sos = v.status === 'sos'
    ? `<div style="position:absolute;inset:-7px;border-radius:50%;border:2px solid ${color}88;animation:lf-sos-ring .65s ease-in-out infinite;pointer-events:none"></div>` : ''
  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none">
      <div style="position:relative;overflow:visible;width:22px;height:22px;border-radius:50%;background:rgba(5,7,13,.92);border:2px solid ${color};display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px ${color}44,0 2px 8px rgba(0,0,0,.8);pointer-events:all;cursor:pointer;${v.status==='sos'?'animation:lf-sos-marker .65s ease-in-out infinite':''}">
        ${pulse}${sos}
        <div style="width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 5px ${color};pointer-events:none"></div>
      </div>
      <div style="display:flex;gap:3px;align-items:center;background:rgba(5,7,13,.95);border:1px solid ${color}44;border-radius:3px;padding:1px 6px;pointer-events:none;white-space:nowrap">
        <span style="font-family:JetBrains Mono,IBM Plex Mono,monospace;font-size:9px;font-weight:700;color:#e8a830">${reg}</span>
        <span style="font-family:JetBrains Mono,IBM Plex Mono,monospace;font-size:8px;color:${color};font-weight:600">${label}</span>
      </div>
    </div>`
  return wrap
}

interface Props { vehicles: LiveVehicle[]; selectedId: string | null; onSelect: (v: LiveVehicle) => void }

export default function FleetMap({ vehicles, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const coordsRef = useRef<HTMLSpanElement>(null)
  const animRef = useRef(0)
  const [mapReady, setMapReady] = useState(false)
  const [isSatellite, setIsSatellite] = useState(false)

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
    const m = new maplibregl.Map({ container: containerRef.current, style: DARK_STYLE, center: [35.5, 1.2], zoom: 5, attributionControl: false })
    m.on('style.load', () => setMapReady(true))
    m.on('mousemove', e => {
      if (!coordsRef.current) return
      const { lat, lng } = e.lngLat
      coordsRef.current.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`
    })
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null; setMapReady(false) }
  }, [])

  // satellite toggle
  const toggleSatellite = () => {
    const map = mapRef.current; if (!map) return
    setIsSatellite(prev => {
      const next = !prev
      setMapReady(false)
      map.setStyle(next ? SATELLITE_STYLE : DARK_STYLE)
      return next
    })
  }

  // geofence overlay
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    const fc = buildGeoFC(geofences ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = map.getSource('geofences') as any
    if (src) { src.setData(fc); return }
    if (!fc.features.length) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.addSource('geofences', { type: 'geojson', data: fc } as any)
    map.addLayer({ id: 'geofences-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.12 } })
    map.addLayer({ id: 'geofences-line', type: 'line', source: 'geofences', paint: { 'line-color': '#22d3ee', 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [5, 3] } })
  }, [mapReady, geofences])

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
    for (const v of positioned) {
      const existing = markersRef.current.get(v.id)
      if (existing) {
        existing.setLngLat([v.lng!, v.lat!])
        const el = existing.getElement(); el.innerHTML = makeEl(v).innerHTML
        const inner = el.firstElementChild as HTMLElement | null
        if (inner) inner.addEventListener('click', e => { e.stopPropagation(); onSelect(v) }, { once: true })
      } else {
        const el = makeEl(v)
        const inner = el.firstElementChild as HTMLElement | null
        if (inner) inner.addEventListener('click', e => { e.stopPropagation(); onSelect(v) })
        const marker = new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([v.lng!, v.lat!]).addTo(map)
        markersRef.current.set(v.id, marker)
      }
    }
  }, [vehicles, onSelect])

  // fly to selected
  useEffect(() => {
    const map = mapRef.current; if (!map || !selectedId) return
    const v = vehicles.find(x => x.id === selectedId)
    if (v?.lat != null) map.flyTo({ center: [v.lng!, v.lat!], zoom: Math.max(map.getZoom(), 9), duration: 700 })
  }, [selectedId, vehicles])

  // keyframes
  useEffect(() => {
    if (document.getElementById('lf-map-styles')) return
    const s = document.createElement('style'); s.id = 'lf-map-styles'
    s.textContent = `
      @keyframes lf-mping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.2);opacity:0}}
      @keyframes lf-sos-ring{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.5);opacity:.2}}
      @keyframes lf-sos-marker{0%,100%{box-shadow:0 0 12px #ef444466,0 2px 8px rgba(0,0,0,.8)}50%{box-shadow:0 0 24px #ef4444cc,0 2px 8px rgba(0,0,0,.8)}}
    `
    document.head.appendChild(s)
  }, [])

  const geoCount = geofences?.length ?? 0
  const riskCount = riskZones?.length ?? 0

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#05070d' }} />

      {/* top-right controls */}
      <div style={{ position: 'absolute', right: 14, top: 14, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* satellite toggle */}
        <button onClick={toggleSatellite} title={isSatellite ? 'Dark map' : 'Satellite'} style={{ width: 34, height: 34, borderRadius: 7, background: isSatellite ? 'rgba(232,168,48,.18)' : 'rgba(8,11,20,.92)', border: `1px solid ${isSatellite ? 'rgba(232,168,48,.6)' : 'rgba(255,255,255,.11)'}`, color: isSatellite ? '#e8a830' : '#7a7e8a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

      {/* layer legend */}
      <div style={{ position: 'absolute', right: 56, top: 14, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {geoCount > 0 && (
          <div style={{ background: 'rgba(8,11,20,.92)', border: '1px solid rgba(34,211,238,.3)', borderRadius: 5, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, border: '1.5px dashed #22d3ee', opacity: .85 }} />
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, color: '#22d3ee' }}>{geoCount} zones</span>
          </div>
        )}
        {riskCount > 0 && (
          <div style={{ background: 'rgba(8,11,20,.92)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 5, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', opacity: .85 }} />
            <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, color: '#ef4444' }}>{riskCount} risk zones</span>
          </div>
        )}
      </div>

      {/* coords */}
      <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 500, background: 'rgba(8,11,20,.85)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 4, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7a7e8a" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span ref={coordsRef} style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, color: '#7a7e8a' }}>hover for coords</span>
      </div>
    </div>
  )
}
