// Shared traffic-overlay logic for GPS Live (FleetMap) and Tactical Map —
// both are separate MapLibre instances with their own style/source setup
// (no shared map component exists in this app), so this holds the one copy
// of the add/update/visibility logic each component wires into its own
// lifecycle instead of duplicating the GeoJSON/raster plumbing twice.
//
// Coverage caveat: TomTom (the backing provider) has no flow/incident data
// in several conflict corridors this app already tracks in Risk Intel
// (Somalia, Mali, Sudan, Ethiopia, Yemen, Iraq, Syria, Pakistan, Afghanistan
// as of this writing) — an empty overlay there means "no data", not "clear
// roads". Components using this should surface that, not just render blank.
import type maplibregl from 'maplibre-gl'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { api } from './api.js'
import { getAccessToken } from '../stores/auth.js'

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1'

export const TRAFFIC_FLOW_TILE_URL = `${API_BASE}/traffic/tiles/flow/{z}/{x}/{y}.png`

// MapLibre issues raw fetch/XHR requests for every tile/resource with no
// way to pass custom headers unless told to via `transformRequest` on the
// Map constructor — our backend route requires the same Bearer auth as
// every other API call, so tile/incident requests need this or they 401.
export function trafficTransformRequest(url: string): { url: string; headers?: Record<string, string> } {
  if (url.includes('/traffic/tiles/') || url.includes('/traffic/incidents')) {
    const token = getAccessToken()
    return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url }
  }
  return { url }
}

export function useTrafficStatus() {
  return useQuery<{ configured: boolean }>({
    queryKey: ['traffic-status'],
    queryFn: async () => (await api.get('/traffic/status')).data as { configured: boolean },
    staleTime: 5 * 60_000,
  })
}

export function useTrafficIncidents(bbox: string | null, enabled: boolean): UseQueryResult<GeoJSON.FeatureCollection> {
  return useQuery<GeoJSON.FeatureCollection>({
    queryKey: ['traffic-incidents', bbox],
    queryFn: async () => (await api.get('/traffic/incidents', { params: { bbox } })).data as GeoJSON.FeatureCollection,
    enabled: enabled && !!bbox,
    staleTime: 90_000,
    refetchInterval: 120_000,
  })
}

// magnitudeOfDelay: TomTom's 0-4 severity scale (0=unknown, 4=road closure).
const MAGNITUDE_COLOR: Record<number, string> = {
  0: '#6b7280', 1: '#eab308', 2: '#f97316', 3: '#ef4444', 4: '#991b1b',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TRAFFIC_INCIDENT_COLOR_EXPR: any = [
  'match', ['get', 'magnitudeOfDelay'],
  1, MAGNITUDE_COLOR[1], 2, MAGNITUDE_COLOR[2], 3, MAGNITUDE_COLOR[3], 4, MAGNITUDE_COLOR[4],
  MAGNITUDE_COLOR[0],
]

// Sources/layers added once per style load (MapLibre wipes everything on
// `setStyle()`, so callers re-invoke this from their own style-reload path —
// same pattern each component already uses for its other overlays). Safe to
// call repeatedly: guarded by `getSource` so it never double-adds.
export function addTrafficLayers(map: maplibregl.Map, visible: boolean) {
  const vis = visible ? 'visible' : 'none'

  if (!map.getSource('traffic-flow')) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.addSource('traffic-flow', { type: 'raster', tiles: [TRAFFIC_FLOW_TILE_URL], tileSize: 256 } as any)
    map.addLayer({ id: 'traffic-flow-layer', type: 'raster', source: 'traffic-flow', layout: { visibility: vis }, paint: { 'raster-opacity': 0.75 } })
  }

  if (!map.getSource('traffic-incidents')) {
    map.addSource('traffic-incidents', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: 'traffic-incidents-line', type: 'line', source: 'traffic-incidents',
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { visibility: vis, 'line-cap': 'round' },
      paint: { 'line-color': TRAFFIC_INCIDENT_COLOR_EXPR, 'line-width': 4, 'line-opacity': 0.8 },
    })
    map.addLayer({
      id: 'traffic-incidents-point', type: 'circle', source: 'traffic-incidents',
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { visibility: vis },
      paint: { 'circle-radius': 6, 'circle-color': TRAFFIC_INCIDENT_COLOR_EXPR, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000000' },
    })
  }
}

export function setTrafficLayersVisible(map: maplibregl.Map, visible: boolean) {
  const vis = visible ? 'visible' : 'none'
  for (const id of ['traffic-flow-layer', 'traffic-incidents-line', 'traffic-incidents-point']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
  }
}

export function setTrafficIncidents(map: maplibregl.Map, fc: GeoJSON.FeatureCollection) {
  const src = map.getSource('traffic-incidents') as maplibregl.GeoJSONSource | undefined
  src?.setData(fc)
}

export function bboxFromMap(map: maplibregl.Map): string {
  const b = map.getBounds()
  return `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`
}
