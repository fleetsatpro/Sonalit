import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../../../lib/api.js'
import type { LiveVehicle, LiveStatus } from '../types/fleet.js'

// CARTO dark-matter vector GL style — highest quality, crisp vector rendering
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const STATUS_COLOR: Record<LiveStatus, string> = {
  move: '#16c784', idle: '#f59e0b', stop: '#475569', offline: '#3e4252', sos: '#ef4444',
}

interface Geofence {
  id: string; name: string; type: string
  coordinates: unknown
  radius: number | null; lat: number | null; lng: number | null
}

type GeoRing = [number, number][]
type GeoFC = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Polygon'; coordinates: GeoRing[] }
    properties: { id: string; name: string }
  }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRing(coordinates: any): GeoRing | null {
  if (!coordinates) return null
  // Direct ring array: [[lng,lat], ...]
  if (Array.isArray(coordinates) && coordinates.length > 0 && Array.isArray(coordinates[0])) {
    return coordinates as GeoRing
  }
  const type: string = coordinates.type
  // GeoJSON Polygon
  if (type === 'Polygon' && Array.isArray(coordinates.coordinates)) {
    return (coordinates.coordinates[0] as GeoRing) ?? null
  }
  // GeoJSON MultiPolygon
  if (type === 'MultiPolygon' && Array.isArray(coordinates.coordinates)) {
    return (coordinates.coordinates[0]?.[0] as GeoRing) ?? null
  }
  // GeoJSON Feature
  if (type === 'Feature' && coordinates.geometry) {
    return extractRing(coordinates.geometry)
  }
  // GeoJSON FeatureCollection
  if (type === 'FeatureCollection' && Array.isArray(coordinates.features)) {
    for (const f of coordinates.features) {
      const r = extractRing(f.geometry)
      if (r) return r
    }
  }
  return null
}

function buildGeoFC(geofences: Geofence[]): GeoFC {
  const features: GeoFC['features'] = []
  for (const g of geofences) {
    // Prefer real polygon coordinates over circle approximation
    const ring = extractRing(g.coordinates)
    if (ring?.length) {
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id: g.id, name: g.name } })
    }
    // No circle fallback — if there's no polygon, skip the geofence
  }
  return { type: 'FeatureCollection', features }
}

function makeEl(v: LiveVehicle): HTMLElement {
  const color = STATUS_COLOR[v.status]
  const spd = Math.round(v.speed_kmh)
  const reg = v.registration.length > 10 ? v.registration.slice(0, 10) : v.registration
  const label = v.status === 'sos' ? 'SOS' : v.status === 'move' ? `${spd}` : v.status === 'offline' ? 'OFF' : v.status.toUpperCase().slice(0, 4)

  const pulse = (v.status === 'move' || v.status === 'idle')
    ? `<div style="position:absolute;inset:-6px;border-radius:50%;border:1.5px solid ${color}55;animation:lf-mping 2.2s ease-out infinite;pointer-events:none"></div>`
    : ''
  const sosBlink = v.status === 'sos'
    ? `<div style="position:absolute;inset:-7px;border-radius:50%;border:2px solid ${color}88;animation:lf-sos-ring .65s ease-in-out infinite;pointer-events:none"></div>`
    : ''

  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none">
      <div style="
        position:relative;overflow:visible;
        width:22px;height:22px;border-radius:50%;
        background:rgba(5,7,13,.92);
        border:2px solid ${color};
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 0 12px ${color}44,0 2px 8px rgba(0,0,0,.8);
        pointer-events:all;cursor:pointer;
        ${v.status === 'sos' ? 'animation:lf-sos-marker .65s ease-in-out infinite' : ''}
      ">
        ${pulse}${sosBlink}
        <div style="width:7px;height:7px;border-radius:50%;background:${color};box-shadow:0 0 5px ${color};pointer-events:none"></div>
      </div>
      <div style="
        display:flex;gap:3px;align-items:center;
        background:rgba(5,7,13,.95);
        border:1px solid ${color}44;border-radius:3px;
        padding:1px 6px;pointer-events:none;white-space:nowrap;
      ">
        <span style="font-family:JetBrains Mono,IBM Plex Mono,monospace;font-size:9px;font-weight:700;color:#e8a830;letter-spacing:.02em">${reg}</span>
        <span style="font-family:JetBrains Mono,IBM Plex Mono,monospace;font-size:8px;color:${color};font-weight:600">${v.status === 'move' ? label + ' km/h' : label}</span>
      </div>
    </div>`
  return wrap
}

interface Props {
  vehicles: LiveVehicle[]
  selectedId: string | null
  onSelect: (v: LiveVehicle) => void
}

export default function FleetMap({ vehicles, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const coordsRef = useRef<HTMLSpanElement>(null)
  const [mapReady, setMapReady] = useState(false)

  const { data: geofences } = useQuery<Geofence[]>({
    queryKey: ['live-fleet-geofences'],
    queryFn: async () => {
      const r = await api.get<{ data: Geofence[] }>('/geofences')
      return r.data.data ?? []
    },
    staleTime: 120_000,
    refetchInterval: 120_000,
  })

  // init map with vector dark-matter style
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [35.5, 1.2],
      zoom: 5,
      attributionControl: false,
    })
    m.on('load', () => setMapReady(true))
    m.on('mousemove', e => {
      if (!coordsRef.current) return
      const { lat, lng } = e.lngLat
      coordsRef.current.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`
    })
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null; setMapReady(false) }
  }, [])

  // geofence overlay — polygon fill + dashed border
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !geofences?.length) return
    const fc = buildGeoFC(geofences)
    if (!fc.features.length) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = map.getSource('geofences') as any
    if (src) {
      src.setData(fc)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.addSource('geofences', { type: 'geojson', data: fc } as any)
      map.addLayer({ id: 'geofences-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': '#e8a830', 'fill-opacity': 0.08 } })
      map.addLayer({ id: 'geofences-line', type: 'line', source: 'geofences', paint: { 'line-color': '#e8a830', 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [5, 3] } })
    }
  }, [mapReady, geofences])

  // sync vehicle markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const positioned = vehicles.filter(v => v.lat != null && v.lng != null)
    const ids = new Set(positioned.map(v => v.id))

    for (const [id, marker] of markersRef.current) {
      if (!ids.has(id)) { marker.remove(); markersRef.current.delete(id) }
    }

    for (const v of positioned) {
      const existing = markersRef.current.get(v.id)
      if (existing) {
        existing.setLngLat([v.lng!, v.lat!])
        const newEl = makeEl(v)
        const oldEl = existing.getElement()
        oldEl.innerHTML = newEl.innerHTML
        const inner = oldEl.firstElementChild as HTMLElement | null
        if (inner) inner.addEventListener('click', e => { e.stopPropagation(); onSelect(v) }, { once: true })
      } else {
        const el = makeEl(v)
        const inner = el.firstElementChild as HTMLElement | null
        if (inner) inner.addEventListener('click', e => { e.stopPropagation(); onSelect(v) })
        const marker = new maplibregl.Marker({ element: el, anchor: 'top' })
          .setLngLat([v.lng!, v.lat!])
          .addTo(map)
        markersRef.current.set(v.id, marker)
      }
    }
  }, [vehicles, onSelect])

  // fly to selected
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const v = vehicles.find(x => x.id === selectedId)
    if (v?.lat != null) map.flyTo({ center: [v.lng!, v.lat!], zoom: Math.max(map.getZoom(), 9), duration: 700 })
  }, [selectedId, vehicles])

  // inline keyframes
  useEffect(() => {
    if (document.getElementById('lf-map-styles')) return
    const s = document.createElement('style')
    s.id = 'lf-map-styles'
    s.textContent = `
      @keyframes lf-mping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.2);opacity:0}}
      @keyframes lf-sos-ring{0%,100%{transform:scale(1);opacity:.8}50%{transform:scale(1.5);opacity:.2}}
      @keyframes lf-sos-marker{0%,100%{box-shadow:0 0 12px #ef444466,0 2px 8px rgba(0,0,0,.8)}50%{box-shadow:0 0 24px #ef4444cc,0 2px 8px rgba(0,0,0,.8)}}
    `
    document.head.appendChild(s)
  }, [])

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#05070d' }} />

      {/* zoom + fit controls */}
      <div style={{ position: 'absolute', right: 14, top: 14, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          { label: '+', fn: () => mapRef.current?.zoomIn() },
          { label: '−', fn: () => mapRef.current?.zoomOut() },
          { label: '⊕', fn: () => {
            const p = vehicles.filter(v => v.lat != null)
            if (p.length && mapRef.current) {
              const lngs = p.map(v => v.lng!); const lats = p.map(v => v.lat!)
              mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: 8 })
            }
          }},
        ].map(btn => (
          <button key={btn.label} onClick={btn.fn} style={{ width: 34, height: 34, borderRadius: 7, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.11)', color: '#7a7e8a', fontFamily: 'IBM Plex Mono,monospace', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* geofence count badge */}
      {(geofences?.length ?? 0) > 0 && (
        <div style={{ position: 'absolute', right: 56, top: 14, zIndex: 500, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(232,168,48,.25)', borderRadius: 5, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, border: '1.5px dashed #e8a830', opacity: .7 }} />
          <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, color: '#e8a830' }}>{geofences!.length} zones</span>
        </div>
      )}

      {/* coords */}
      <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 500, background: 'rgba(8,11,20,.85)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 4, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7a7e8a" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span ref={coordsRef} style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 9, color: '#7a7e8a' }}>hover for coords</span>
      </div>
    </div>
  )
}
