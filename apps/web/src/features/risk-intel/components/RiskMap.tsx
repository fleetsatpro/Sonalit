import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { STREET_STYLE, SAT_STYLE } from '../../../lib/mapStyles.js'
import { geoCircle } from '../../../lib/geoMath.js'
import { CONTINENT_VIEWS } from '../utils/map.js'
import { LEVEL_COLOR } from '../utils/colors.js'
import MapPopup from './MapPopup.js'
import type { RiskZone, Continent } from '../types/risk.js'

interface Props {
  zones: RiskZone[]
  activeCont: Continent
  activeZoneId: string | null
  heatVisible: boolean
  onZoneClick: (id: string) => void
}

type ZoneFC = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Polygon'; coordinates: [number, number][][] } | { type: 'Point'; coordinates: [number, number] }
    properties: { id: string; level: string; weight: number }
  }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LEVEL_MATCH: any = [
  'match', ['get', 'level'],
  'high', LEVEL_COLOR.high,
  'medium', LEVEL_COLOR.medium,
  'low', LEVEL_COLOR.low,
  '#6e6c64',
]

function buildZoneFC(zones: RiskZone[]): ZoneFC {
  return {
    type: 'FeatureCollection',
    features: zones
      .filter(z => z.map_lat != null && z.map_lon != null)
      .map(z => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [geoCircle(z.map_lat, z.map_lon, Number(z.radius_km) || 5)],
        },
        properties: { id: z.id, level: z.level, weight: 1 + (z.events_24h ?? 0) },
      })),
  }
}

function buildPointFC(zones: RiskZone[]): ZoneFC {
  return {
    type: 'FeatureCollection',
    features: zones
      .filter(z => z.map_lat != null && z.map_lon != null)
      .map(z => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [z.map_lon, z.map_lat] },
        properties: { id: z.id, level: z.level, weight: 1 + (z.events_24h ?? 0) },
      })),
  }
}

export default function RiskMap({ zones, activeCont, activeZoneId, heatVisible, onZoneClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const animRef = useRef(0)
  const [mapReady, setMapReady] = useState(false)
  const [isSatellite, setIsSatellite] = useState(false)
  const [popup, setPopup] = useState<{ zone: RiskZone; x: number; y: number } | null>(null)
  const zonesRef = useRef(zones)
  useEffect(() => { zonesRef.current = zones }, [zones])

  // init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: STREET_STYLE,
      center: [20, 10],
      zoom: 1.3,
      attributionControl: false,
    })
    m.addControl(new maplibregl.AttributionControl({ compact: true }))
    m.on('load', () => setMapReady(true))
    mapRef.current = m

    // The container's box changes size on continent-bar layout shifts and
    // (on mobile) when the list/map tab toggles it from display:none to
    // flex — MapLibre only auto-resizes on window resize, not container
    // resize, so without this the canvas stays whatever size it was at
    // construction and the map renders truncated/cut off.
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(containerRef.current)

    return () => { ro.disconnect(); m.remove(); mapRef.current = null; setMapReady(false) }
  }, [])

  const toggleSatellite = () => {
    const map = mapRef.current; if (!map) return
    setMapReady(false)
    setIsSatellite(prev => {
      const next = !prev
      map.setStyle(next ? SAT_STYLE : STREET_STYLE)
      map.once('style.load', () => setMapReady(true))
      return next
    })
  }

  // zone circles + heatmap layers (created once, updated via setData after)
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    const zoneFC = buildZoneFC(zones)
    const pointFC = buildPointFC(zones)

    const zoneSrc = map.getSource('rz-zones') as maplibregl.GeoJSONSource | undefined
    const pointSrc = map.getSource('rz-points') as maplibregl.GeoJSONSource | undefined

    if (zoneSrc && pointSrc) {
      zoneSrc.setData(zoneFC as GeoJSON.FeatureCollection)
      pointSrc.setData(pointFC as GeoJSON.FeatureCollection)
      return
    }

    map.addSource('rz-zones', { type: 'geojson', data: zoneFC as GeoJSON.FeatureCollection })
    map.addSource('rz-points', { type: 'geojson', data: pointFC as GeoJSON.FeatureCollection })

    map.addLayer({ id: 'rz-heat', type: 'heatmap', source: 'rz-points', paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0.2, 20, 1],
      'heatmap-intensity': 1.1,
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 1, 22, 6, 60],
      'heatmap-opacity': 0.55,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0,    'rgba(0,0,0,0)',
        0.2,  'rgba(74,222,128,.5)',
        0.5,  'rgba(239,159,39,.6)',
        1,    'rgba(226,75,74,.85)',
      ],
    } })

    map.addLayer({ id: 'rz-glow', type: 'fill', source: 'rz-zones', paint: { 'fill-color': LEVEL_MATCH, 'fill-opacity': 0.15 } })
    map.addLayer({ id: 'rz-fill', type: 'fill', source: 'rz-zones', paint: { 'fill-color': LEVEL_MATCH, 'fill-opacity': 0.18 } })
    map.addLayer({ id: 'rz-line', type: 'line', source: 'rz-zones', paint: { 'line-color': LEVEL_MATCH, 'line-width': 2, 'line-opacity': 0.9 } })
    map.addLayer({ id: 'rz-active-line', type: 'line', source: 'rz-zones', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': LEVEL_MATCH, 'line-width': 3.5, 'line-opacity': 1 } })
    map.addLayer({ id: 'rz-dot', type: 'circle', source: 'rz-points', paint: {
      'circle-radius': 5, 'circle-color': LEVEL_MATCH, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#0d1520',
    } })

    const handleZoneClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const id = (f.properties as { id: string } | undefined)?.id
      const zone = zones.find(z => z.id === id)
      if (!zone) return
      const point = map.project([zone.map_lon, zone.map_lat])
      setPopup({ zone, x: point.x, y: point.y })
      onZoneClick(zone.id)
    }
    // rz-fill is the zone's radius_km circle, which at low/global zoom can
    // render at only a few pixels (or sub-pixel) — the rz-dot marker is what
    // a tap actually lands on in that case, so both layers need the same
    // click/hover wiring or "clicking the pin" silently does nothing.
    for (const layer of ['rz-fill', 'rz-dot']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      map.on('click', layer, handleZoneClick)
    }
  }, [mapReady, zones, onZoneClick])

  // highlight the selected zone's outline
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady || !map.getLayer('rz-active-line')) return
    map.setFilter('rz-active-line', ['==', ['get', 'id'], activeZoneId ?? ''])
  }, [activeZoneId, mapReady, zones])

  // zoom in to the selected zone, whether it was picked from the map or
  // the sidebar list. Keyed only on activeZoneId/mapReady (via zonesRef)
  // so the 60s background refetch of `zones` doesn't re-trigger the flight.
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady || !activeZoneId) return
    const zone = zonesRef.current.find(z => z.id === activeZoneId)
    if (!zone) return
    map.flyTo({ center: [zone.map_lon, zone.map_lat], zoom: Math.max(map.getZoom(), 6), duration: 900 })
  }, [activeZoneId, mapReady])

  // toggle heat layer visibility
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    if (!map.getLayer('rz-heat')) return
    map.setLayoutProperty('rz-heat', 'visibility', heatVisible ? 'visible' : 'none')
  }, [heatVisible, mapReady])

  // pulse the glow layer
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    let t = 0
    const loop = () => {
      const p = 0.08 + 0.16 * (0.5 + 0.5 * Math.sin(t)); t += 0.04
      try { if (map.getLayer('rz-glow')) map.setPaintProperty('rz-glow', 'fill-opacity', p) } catch { /* layer torn down mid-frame */ }
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [mapReady])

  // fly to continent — fit to the zones actually present rather than a
  // fixed zoom, so a continent with a few clustered zones doesn't end up
  // over- or under-cropped relative to one with many spread-out ones
  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return
    map.resize() // guard against a resize that hasn't been picked up yet
    const inCont = zonesRef.current.filter(z => activeCont === 'global' || z.continent === activeCont)
    const pts = inCont.filter(z => z.map_lat != null && z.map_lon != null)

    if (pts.length >= 2) {
      const lngs = pts.map(z => z.map_lon)
      const lats = pts.map(z => z.map_lat)
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 60, maxZoom: 6, duration: 900 },
      )
    } else if (pts.length === 1) {
      map.flyTo({ center: [pts[0]!.map_lon, pts[0]!.map_lat], zoom: 5, duration: 900 })
    } else {
      const view = CONTINENT_VIEWS[activeCont] ?? CONTINENT_VIEWS['global']!
      map.flyTo({ center: view.center, zoom: view.zoom, duration: 900 })
    }
  }, [activeCont, mapReady])

  // keep popup position synced while panning/zooming; close on background click
  useEffect(() => {
    const map = mapRef.current; if (!map) return
    const sync = () => {
      setPopup(p => {
        if (!p) return p
        const point = map.project([p.zone.map_lon, p.zone.map_lat])
        return { ...p, x: point.x, y: point.y }
      })
    }
    map.on('move', sync)
    return () => { map.off('move', sync) }
  }, [])

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#0a1424' }} onClick={() => setPopup(null)} />

      {popup && (
        <MapPopup
          zone={popup.zone}
          x={popup.x}
          y={popup.y}
          onOpen={() => onZoneClick(popup.zone.id)}
        />
      )}

      {/* top-right controls */}
      <div style={{ position: 'absolute', right: 14, top: 14, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          onClick={toggleSatellite}
          title={isSatellite ? 'Street map' : 'Satellite'}
          style={{
            width: 32, height: 32, borderRadius: 6,
            background: isSatellite ? 'rgba(240,180,41,.18)' : 'rgba(8,11,20,.92)',
            border: `1px solid ${isSatellite ? 'rgba(240,180,41,.5)' : 'rgba(255,255,255,.1)'}`,
            color: isSatellite ? '#F0B429' : '#9a9890', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><line x1="2" y1="12" x2="22" y2="12" />
          </svg>
        </button>
        <button onClick={() => mapRef.current?.zoomIn()} style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.1)', color: '#9a9890', fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, cursor: 'pointer' }}>+</button>
        <button onClick={() => mapRef.current?.zoomOut()} style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(8,11,20,.92)', border: '1px solid rgba(255,255,255,.1)', color: '#9a9890', fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, cursor: 'pointer' }}>−</button>
      </div>
    </div>
  )
}
