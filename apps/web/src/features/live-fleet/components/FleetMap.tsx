import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LiveVehicle, LiveStatus } from '../types/fleet.js'

const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/dark_matter/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© CARTO © OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-brightness-min': 0.05 } }],
}

const STATUS_COLOR: Record<LiveStatus, string> = {
  move: '#16c784', idle: '#f59e0b', stop: '#475569', offline: '#3e4252', sos: '#ef4444',
}
const STATUS_BG: Record<LiveStatus, string> = {
  move: '#071b12', idle: '#1e1504', stop: '#0f1420', offline: '#0a0b10', sos: '#1a0505',
}

function makeEl(v: LiveVehicle): HTMLElement {
  const color = STATUS_COLOR[v.status]
  const bg    = STATUS_BG[v.status]
  const spd   = Math.round(v.speed_kmh)
  const ping = v.status === 'move' || v.status === 'sos'
    ? `<div style="position:absolute;inset:-5px;border-radius:14px;border:1px solid ${color}44;animation:lf-mping 2s ease-out infinite"></div>`
    : ''
  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
      <div style="
        width:34px;height:34px;border-radius:9px;
        background:${bg};border:1.5px solid ${color}88;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 4px 16px rgba(0,0,0,.6);
        position:relative;overflow:visible;
        pointer-events:all;cursor:pointer;
        ${v.status === 'sos' ? 'animation:lf-sos-marker .7s ease-in-out infinite' : ''}
      ">
        ${ping}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/>
          <circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
      </div>
      <div style="
        margin-top:3px;padding:2px 7px;
        background:rgba(8,11,20,.9);border:1px solid rgba(255,255,255,.1);border-radius:4px;
        display:flex;align-items:center;gap:5px;
        font-family:JetBrains Mono,IBM Plex Mono,monospace;font-size:9px;font-weight:500;white-space:nowrap;
        pointer-events:none;
      ">
        <span style="color:#e8a830">${v.registration.slice(0,8)}</span>
        <span style="color:${color};font-weight:600">${v.status === 'sos' ? 'SOS' : v.status === 'move' ? spd + ' km/h' : v.status.toUpperCase()}</span>
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

  // init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [35.5, 1.2],
      zoom: 5,
      attributionControl: false,
    })
    m.on('mousemove', e => {
      if (!coordsRef.current) return
      const { lat, lng } = e.lngLat
      coordsRef.current.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`
    })
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null }
  }, [])

  // sync markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const positioned = vehicles.filter(v => v.lat != null && v.lng != null)
    const ids = new Set(positioned.map(v => v.id))

    // remove stale
    for (const [id, marker] of markersRef.current) {
      if (!ids.has(id)) { marker.remove(); markersRef.current.delete(id) }
    }

    for (const v of positioned) {
      const existing = markersRef.current.get(v.id)
      if (existing) {
        existing.setLngLat([v.lng!, v.lat!])
        // update element
        const newEl = makeEl(v)
        const inner = newEl.firstElementChild as HTMLElement | null
        if (inner) {
          const oldEl = existing.getElement()
          oldEl.innerHTML = inner.outerHTML
        }
      } else {
        const el = makeEl(v)
        const inner = el.firstElementChild as HTMLElement | null
        if (inner) {
          inner.addEventListener('click', e => { e.stopPropagation(); onSelect(v) })
        }
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
    if (v?.lat != null) {
      map.flyTo({ center: [v.lng!, v.lat!], zoom: Math.max(map.getZoom(), 9), duration: 700 })
    }
  }, [selectedId, vehicles])

  // add inline keyframe CSS once
  useEffect(() => {
    if (document.getElementById('lf-map-styles')) return
    const s = document.createElement('style')
    s.id = 'lf-map-styles'
    s.textContent = `
      @keyframes lf-mping{0%{transform:scale(1);opacity:.8}100%{transform:scale(1.8);opacity:0}}
      @keyframes lf-sos-marker{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.5),0 4px 16px rgba(0,0,0,.6)}50%{box-shadow:0 0 0 8px rgba(239,68,68,0),0 4px 16px rgba(0,0,0,.6)}}
    `
    document.head.appendChild(s)
  }, [])

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#05070d' }} />

      {/* zoom controls */}
      <div style={{ position: 'absolute', right: 14, top: 14, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          { label: '+', fn: () => mapRef.current?.zoomIn() },
          { label: '−', fn: () => mapRef.current?.zoomOut() },
          { label: '⊕', fn: () => { const b = vehicles.filter(v => v.lat != null).map(v => [v.lng!, v.lat!] as [number,number]); if (b.length && mapRef.current) mapRef.current.fitBounds(b as any, { padding: 80, maxZoom: 8 }) } },
        ].map(btn => (
          <button key={btn.label} onClick={btn.fn} style={{ width: 34, height: 34, borderRadius: 7, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.11)', color: '#7a7e8a', fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* coords */}
      <div style={{ position: 'absolute', bottom: 14, left: 14, zIndex: 500, background: 'rgba(8,11,20,.85)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 4, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7a7e8a" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span ref={coordsRef} style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#7a7e8a' }}>hover for coords</span>
      </div>
    </div>
  )
}
