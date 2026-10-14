import { spatialPixelRatio, spatialCanvasContextAttributes } from '../../../lib/spatialRendering.js'
import { STREET_STYLE } from '../../../lib/mapStyles.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../../../lib/api.js'
import {
  trafficTransformRequest, addTrafficLayers, setTrafficLayersVisible, setTrafficIncidents,
  bboxFromMap, useTrafficIncidents, useTrafficStatus,
} from '../../../lib/trafficLayer.js'
import type { LiveVehicle, LiveStatus } from '../types/fleet.js'
import '../../../styles/spatial-command.css'

installOpticalReconMapLibreProtocol()
import { externalWorldFeatures, fetchWorldContext, worldContextEntities, WORLD_CONTEXT_LAYERS } from '../../../lib/spatialClient.js'
import type { SpatialWorldEntity } from '../../../lib/spatialClient.js'
import { buildCorridorSignalOverlay } from '../../../components/geofences/geofenceSegmentSignals.js'
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
  corridor_width_km?: number | null
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

function corridorBufferMetres(g: Geofence): number {
  let coordinates: unknown = g.coordinates
  if (typeof coordinates === 'string') {
    try { coordinates = JSON.parse(coordinates) } catch { coordinates = null }
  }
  if (coordinates && typeof coordinates === 'object' && !Array.isArray(coordinates)) {
    const value = Number((coordinates as Record<string, unknown>).buffer_m)
    if (Number.isFinite(value) && value > 0) return value
  }
  const width = Number(g.corridor_width_km)
  return Number.isFinite(width) && width > 0 ? width * 1000 : 300
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

function weatherConditionLabel(item: SpatialWorldEntity): string {
  return String(item.attributes?.conditions ?? 'weather').replaceAll('_', ' ').toUpperCase()
}

function weatherColor(item: SpatialWorldEntity): string {
  const code = Number(item.attributes?.weatherCode)
  if (Number.isFinite(code) && code >= 95) return '#ff957a'
  if (Number.isFinite(code) && ((code >= 71 && code <= 77) || code === 85 || code === 86)) return '#a6def4'
  if (Number.isFinite(code) && (code === 45 || code === 48)) return '#a9b7c7'
  if (Number.isFinite(code) && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))) return '#73b5ff'
  if (Number.isFinite(code) && (code === 0 || code === 1)) return '#f4ca76'
  return '#8bd9ca'
}

function makeWeatherMarker(item: SpatialWorldEntity, onSelect: (entity: SpatialWorldEntity) => void): HTMLButtonElement {
  const code = Number(item.attributes?.weatherCode)
  const color = weatherColor(item)
  const condition = weatherConditionLabel(item)
  const temperature = Number(item.attributes?.temperatureC)
  const tempLabel = Number.isFinite(temperature) ? `${Math.round(temperature)}°C` : ''
  const glyph = Number.isFinite(code) && code >= 95
    ? '<path d="M14 2 7 13h5l-2 9 8-13h-5z" fill="currentColor" stroke="none"/>'
    : Number.isFinite(code) && ((code >= 71 && code <= 77) || code === 85 || code === 86)
      ? '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M8 4.5l4 3 4-3M8 19.5l4-3 4 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      : Number.isFinite(code) && (code === 45 || code === 48)
        ? '<path d="M3 8h18M1 12h16M4 16h17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
        : Number.isFinite(code) && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
          ? '<path d="M8 15 6 19M13 15l-2 5M18 15l-2 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
          : Number.isFinite(code) && (code === 0 || code === 1)
            ? '<circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
            : '<path d="M7.5 17.5h9a4.3 4.3 0 0 0 .4-8.6A5.5 5.5 0 0 0 6.4 9.8a3.9 3.9 0 0 0 1.1 7.7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
  const marker = document.createElement('button')
  marker.type = 'button'
  marker.className = 'lf-weather-marker'
  marker.dataset.weatherCode = Number.isFinite(code) ? String(code) : 'unknown'
  marker.dataset.condition = String(item.attributes?.conditions ?? 'unknown')
  marker.dataset.freshness = String(item.quality?.freshnessClass ?? 'UNKNOWN').toUpperCase()
  marker.style.setProperty('--weather-color', color)
  const phase = Array.from(String(item.id)).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 58
  marker.style.setProperty('--weather-delay', `${(-phase / 10).toFixed(2)}s`)
  marker.title = `${condition}${tempLabel ? ' · ' + tempLabel : ''} · ${item.source ?? 'unknown source'} · ${item.quality?.freshnessClass ?? 'UNKNOWN'}`
  marker.setAttribute('aria-label', `Inspect weather: ${condition}${tempLabel ? ', ' + tempLabel : ''}`)
  const weatherEffect = Number.isFinite(code) && code >= 95
    ? '<span class="lf-weather-fx lf-weather-fx-storm" aria-hidden="true"></span>'
    : Number.isFinite(code) && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
      ? '<span class="lf-weather-fx lf-weather-fx-rain" aria-hidden="true"><i></i><i></i><i></i></span>'
      : Number.isFinite(code) && ((code >= 71 && code <= 77) || code === 85 || code === 86)
        ? '<span class="lf-weather-fx lf-weather-fx-snow" aria-hidden="true"><i></i><i></i><i></i></span>'
        : Number.isFinite(code) && (code === 45 || code === 48)
          ? '<span class="lf-weather-fx lf-weather-fx-fog" aria-hidden="true"><i></i><i></i></span>'
          : ''
  marker.innerHTML = `
    <span class="lf-weather-ripple" aria-hidden="true"></span>
    <span class="lf-weather-core"><svg viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg>${weatherEffect}</span>
    <span class="lf-weather-label"><b>${condition}</b>${tempLabel ? `<i>${tempLabel}</i>` : ''}</span>
  `
  marker.addEventListener('click', event => { event.stopPropagation(); onSelect(item) })
  return marker
}

function naturalEventColor(item: SpatialWorldEntity): string {
  if (item.entityType === 'earthquake') {
    const magnitude = Number(item.attributes?.magnitude)
    return Number.isFinite(magnitude) && magnitude >= 5.5 ? '#ff9b79' : '#e6a66f'
  }
  if (item.entityType === 'natural_event') {
    const category = (String(item.attributes?.categoryId ?? '') + ' ' + String(item.attributes?.categoryTitle ?? '')).toLowerCase()
    if (category.includes('wildfire') || category.includes('fire')) return '#ef996d'
    if (category.includes('storm') || category.includes('hurricane') || category.includes('cyclone')) return '#df8588'
    if (category.includes('flood')) return '#76b9ed'
    if (category.includes('landslide')) return '#c79b78'
    if (category.includes('dust') || category.includes('haze')) return '#d6bf7d'
    return '#a8bfcc'
  }
  const currentAlert = item.attributes?.usgsCurrentAlert as Record<string, unknown> | undefined
  const alertLevel = String(currentAlert?.alertLevel ?? '').toUpperCase()
  const colorCode = String(currentAlert?.colorCode ?? '').toUpperCase()
  if (alertLevel === 'WARNING' || colorCode === 'RED') return '#f17878'
  if (alertLevel === 'WATCH' || colorCode === 'ORANGE') return '#e99c72'
  if (alertLevel === 'ADVISORY' || colorCode === 'YELLOW') return '#e2c16f'
  const reportType = String(item.attributes?.reportType ?? item.status ?? '')
  return reportType.includes('ERUPTIVE') ? '#e99a9a' : '#d9a67e'
}

function makeNaturalEventMarker(item: SpatialWorldEntity, onSelect: (entity: SpatialWorldEntity) => void): HTMLButtonElement {
  const isEarthquake = item.entityType === 'earthquake'
  const isVolcano = item.entityType === 'volcano' || item.entityType === 'volcanic_activity'
  const isEonetEvent = item.entityType === 'natural_event'
  const color = naturalEventColor(item)
  const magnitude = Number(item.attributes?.magnitude)
  const magnitudeLabel = Number.isFinite(magnitude) ? 'M' + magnitude.toFixed(1) : 'M—'
  const currentAlert = item.attributes?.usgsCurrentAlert as Record<string, unknown> | undefined
  const alertLevel = String(currentAlert?.alertLevel ?? '').toUpperCase()
  const colorCode = String(currentAlert?.colorCode ?? '').toUpperCase()
  const categoryTitle = String(item.attributes?.categoryTitle ?? item.attributes?.categoryId ?? 'NATURAL EVENT')
  const detail = isEarthquake
    ? magnitudeLabel + ' · ' + String(item.attributes?.place ?? 'Earthquake')
    : isVolcano && currentAlert
      ? 'USGS ' + alertLevel + ' / ' + colorCode + ' · ' + String(item.attributes?.name ?? '')
      : isVolcano
        ? String(item.attributes?.reportType ?? 'ACTIVITY REPORTED').replaceAll('_', ' ') + ' · ' + String(item.attributes?.country ?? '')
        : categoryTitle.toUpperCase() + ' · ' + String(item.attributes?.title ?? item.attributes?.name ?? 'Open event')
  const marker = document.createElement('button')
  marker.type = 'button'
  marker.className = 'lf-natural-event-marker'
  marker.dataset.eventType = isEarthquake ? 'earthquake' : isVolcano ? 'volcano' : 'natural-event'
  marker.dataset.naturalCategory = String(item.attributes?.categoryId ?? 'natural-event').toLowerCase()
  marker.dataset.alertLevel = alertLevel || 'NONE'
  marker.dataset.freshness = currentAlert
    ? (String(currentAlert.sourceStatus ?? '') === 'STALE_CACHE_FALLBACK' ? 'STALE' : 'LIVE')
    : String(item.quality?.freshnessClass ?? 'UNKNOWN').toUpperCase()
  marker.style.setProperty('--event-color', color)
  const phase = Array.from(String(item.id)).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 48
  marker.style.setProperty('--event-delay', String(-phase / 8) + 's')
  marker.title = detail + ' · ' + String(item.source ?? 'unknown source') + ' · ' + String(item.quality?.freshnessClass ?? 'UNKNOWN')
  marker.setAttribute('aria-label', 'Inspect ' + (isEarthquake ? 'earthquake: ' : isVolcano ? 'volcanic activity: ' : 'natural event: ') + detail)
  const earthquakeGlyph = '<path d="M2 12h4l2.2-5.5 3.4 11 3.1-9 2.1 3.5H22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  const volcanoGlyph = '<path d="M3.5 19.5 10.2 6.8l2.1 4.1 1.8-2.5 6.4 11.1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M11.4 4.2c-.7 1-.2 1.8.7 2.1M15.1 3c-.7 1-.4 1.7.2 2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  const categoryId = (String(item.attributes?.categoryId ?? '') + ' ' + String(item.attributes?.categoryTitle ?? '')).toLowerCase()
  const eonetGlyph = categoryId.includes('wildfire') || categoryId.includes('fire')
    ? '<path d="M12 22c5 0 8-3.3 7-7.4-.6-2.4-2.3-4.2-4.7-6.8.2 2.8-.9 3.8-2 4.5.2-4-2.2-7.1-4.3-9.3C8.8 8 4.8 10.1 5 15c.1 4.1 3 7 7 7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
    : categoryId.includes('storm') || categoryId.includes('hurricane') || categoryId.includes('cyclone')
      ? '<path d="M5 15.5h11a4 4 0 0 0 .2-8A5.3 5.3 0 0 0 6 9.2a3.2 3.2 0 0 0-1 6.3ZM14 15l-3 5h3l-2 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>'
      : categoryId.includes('flood')
        ? '<path d="M3 8c2.5-3 4.5 3 7 0s4.5 3 7 0 4.5 3 4 0M3 14c2.5-3 4.5 3 7 0s4.5 3 7 0 4.5 3 4 0M3 20c2.5-3 4.5 3 7 0s4.5 3 7 0 4.5 3 4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
        : categoryId.includes('landslide')
          ? '<path d="M3 20 11 5l4 7 2-3 4 11Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m8 20 5-4 3 2" fill="none" stroke="currentColor" stroke-width="1.5"/>'
          : '<path d="M3 9h10M5 13h14M3 17h10M16 7l4 2-4 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
  const category = isEarthquake ? 'EARTHQUAKE' : isVolcano ? currentAlert ? 'VOLCANO ALERT' : 'VOLCANO REPORT' : categoryTitle.toUpperCase()
  const tag = isEarthquake ? magnitudeLabel : isVolcano ? currentAlert ? alertLevel : (item.quality?.freshnessClass === 'STALE' ? 'STALE' : 'REPORTED') : 'OPEN'
  marker.innerHTML = '<span class="lf-natural-event-pulse" aria-hidden="true"></span>' +
    '<span class="lf-natural-event-core"><svg viewBox="0 0 24 24" aria-hidden="true">' + (isEarthquake ? earthquakeGlyph : isVolcano ? volcanoGlyph : eonetGlyph) + '</svg></span>' +
    '<span class="lf-natural-event-label"><b>' + category + '</b><i>' + tag + '</i></span>
  marker.addEventListener('click', event => { event.stopPropagation(); onSelect(item) })
  return marker
}

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

interface Props {
  vehicles: LiveVehicle[];
  selectedId: string | null;
  onSelect: (v: LiveVehicle) => void;
  trackedId?: string | null;
  weatherAnimationEnabled?: boolean;
  weatherEvents?: SpatialWorldEntity[];
  naturalEvents?: SpatialWorldEntity[];
  onWeatherSelect?: (entity: SpatialWorldEntity) => void;
  onNaturalEventSelect?: (entity: SpatialWorldEntity) => void;
  onViewportChange?: (viewport: { latitude: number; longitude: number; radiusM: number; bbox?: [number, number, number, number] }) => void;
}

export default function FleetMap({
  vehicles,
  selectedId,
  onSelect,
  trackedId = null,
  weatherAnimationEnabled = false,
  weatherEvents = [],
  naturalEvents = [],
  onWeatherSelect,
  onNaturalEventSelect,
  onViewportChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const weatherMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const naturalEventMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const onWeatherSelectRef = useRef(onWeatherSelect)
  const onNaturalEventSelectRef = useRef(onNaturalEventSelect)
  const onViewportChangeRef = useRef(onViewportChange)
  onWeatherSelectRef.current = onWeatherSelect
  onNaturalEventSelectRef.current = onNaturalEventSelect
  onViewportChangeRef.current = onViewportChange
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
  const { data: trafficFC } = useTrafficIncidents(bbox, trafficOn)

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

  const signalEntities = useMemo(
    () => worldSpatialOn ? worldContextEntities(worldContext) : [],
    [worldContext, worldSpatialOn],
  )
  const corridorSignalOverlay = useMemo(() => buildCorridorSignalOverlay(
    (geofences ?? [])
      .filter(g => String(g.type).toLowerCase() === 'corridor')
      .map(g => {
        const points = coordsToPoints(g.coordinates)
        return {
          id: g.id,
          name: g.name,
          path: points?.map(([lng, lat]) => [lat, lng] as [number, number]) ?? null,
          buffer_m: corridorBufferMetres(g),
        }
      }),
    signalEntities,
  ), [geofences, signalEntities])

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
      const bounds = m.getBounds()
      let west = bounds.getWest()
      let east = bounds.getEast()
      const south = bounds.getSouth()
      const north = bounds.getNorth()
      // MapLibre can expose inverted longitude bounds around the dateline; use the full longitude span in that case.
      if (west >= east) { west = -180; east = 180 }
      const viewport = {
        latitude: center.lat,
        longitude: center.lng,
        radiusM: spatialRadiusFromMap(m),
        bbox: [Math.max(-180, west), Math.max(-90, south), Math.min(180, east), Math.min(90, north)] as [number, number, number, number],
      }
      setWorldViewport({ latitude: viewport.latitude, longitude: viewport.longitude, radiusM: viewport.radiusM })
      onViewportChangeRef.current?.(viewport)
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
      map.addLayer({ id: 'gf-line-casing', type: 'line', source: 'gf-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#020617', 'line-width': 10, 'line-opacity': 0.7, 'line-translate': [0, 2], 'line-translate-anchor': 'viewport' } })
      map.addLayer({ id: 'gf-line-buffer', type: 'line', source: 'gf-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#22d3ee', 'line-width': 18, 'line-opacity': 0.26 } })
      map.addLayer({ id: 'gf-line-center', type: 'line', source: 'gf-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#a5f3fc', 'line-width': 4.2, 'line-opacity': 0.98, 'line-dasharray': [6, 3] } })
    }

    const segmentData = corridorSignalOverlay.segments as GeoJSON.FeatureCollection
    const markerData = corridorSignalOverlay.markers as GeoJSON.FeatureCollection
    const segmentSource = map.getSource('gf-signal-segments') as maplibregl.GeoJSONSource | undefined
    if (segmentSource) segmentSource.setData(segmentData)
    else map.addSource('gf-signal-segments', { type: 'geojson', data: segmentData })
    const markerSource = map.getSource('gf-signal-points') as maplibregl.GeoJSONSource | undefined
    if (markerSource) markerSource.setData(markerData)
    else map.addSource('gf-signal-points', { type: 'geojson', data: markerData })

    if (!map.getLayer('gf-signal-shadow')) map.addLayer({
      id: 'gf-signal-shadow', type: 'line', source: 'gf-signal-segments',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#020617', 'line-width': 12, 'line-opacity': 0.72, 'line-translate': [0, 3], 'line-translate-anchor': 'viewport' },
    })
    if (!map.getLayer('gf-signal-glow')) map.addLayer({
      id: 'gf-signal-glow', type: 'line', source: 'gf-signal-segments',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'signal_color'], 'line-width': 18, 'line-opacity': 0.3, 'line-blur': 2.2 },
    })
    if (!map.getLayer('gf-signal-line')) map.addLayer({
      id: 'gf-signal-line', type: 'line', source: 'gf-signal-segments',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'signal_color'], 'line-width': 5.5, 'line-opacity': 0.98 },
    })
    if (!map.getLayer('gf-signal-points-glow')) map.addLayer({
      id: 'gf-signal-points-glow', type: 'circle', source: 'gf-signal-points',
      paint: { 'circle-radius': 10, 'circle-color': ['get', 'signal_color'], 'circle-opacity': 0.22, 'circle-blur': 0.85 },
    })
    if (!map.getLayer('gf-signal-points')) map.addLayer({
      id: 'gf-signal-points', type: 'circle', source: 'gf-signal-points',
      paint: { 'circle-radius': 5, 'circle-color': ['get', 'signal_color'], 'circle-opacity': 0.98, 'circle-stroke-color': '#f8fafc', 'circle-stroke-width': 1.5 },
    })
  }, [mapReady, geofences, corridorSignalOverlay])

  useEffect(() => {
    const map = mapRef.current
    if (!map || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)) return
    let frame = 0
    let last = 0
    const animate = (time: number) => {
      if (time - last >= 84) {
        last = time
        const pulse = (Math.sin(time / 620) + 1) / 2
        try {
          if (map.getLayer('gf-signal-glow')) map.setPaintProperty('gf-signal-glow', 'line-opacity', 0.2 + pulse * 0.2)
          if (map.getLayer('gf-signal-points-glow')) {
            map.setPaintProperty('gf-signal-points-glow', 'circle-radius', 8 + pulse * 4)
            map.setPaintProperty('gf-signal-points-glow', 'circle-opacity', 0.12 + pulse * 0.18)
          }
        } catch { /* style reload can remove layers mid-frame */ }
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [])

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
    const map = mapRef.current; if (!map || !mapReady || !trafficFC) return
    setTrafficIncidents(map, trafficFC)
  }, [trafficFC, mapReady])

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

  // Sourced animated model-grid samples. This is a bounded point overlay, not a fabricated radar footprint.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const marker of weatherMarkersRef.current.values()) marker.remove()
    weatherMarkersRef.current.clear()
    if (!mapReady || !weatherAnimationEnabled) return

    const events = weatherEvents
      .filter(item => item.entityType === 'weather' && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
        && item.latitude >= -90 && item.latitude <= 90 && item.longitude >= -180 && item.longitude <= 180)
      .slice(0, 36)
    for (const item of events) {
      const element = makeWeatherMarker(item, entity => onWeatherSelectRef.current?.(entity))
      const marker = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([item.longitude, item.latitude])
        .addTo(map)
      marker.getElement().style.zIndex = '60'
      weatherMarkersRef.current.set(item.id, marker)
    }
    return () => {
      for (const marker of weatherMarkersRef.current.values()) marker.remove()
      weatherMarkersRef.current.clear()
    }
  }, [mapReady, weatherAnimationEnabled, weatherEvents])


  // The halo marks the catalogue epicentre only; zoom-aware thinning keeps the map legible at global scale.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const renderEvents = () => {
      for (const marker of naturalEventMarkersRef.current.values()) marker.remove()
      naturalEventMarkersRef.current.clear()
      if (!mapReady || !weatherAnimationEnabled) return

      const valid = naturalEvents.filter(item =>
        (item.entityType === 'earthquake' || item.entityType === 'volcano' || item.entityType === 'natural_event') &&
        Number.isFinite(item.latitude) && Number.isFinite(item.longitude) &&
        item.latitude >= -90 && item.latitude <= 90 &&
        item.longitude >= -180 && item.longitude <= 180
      )
      const volcanoes = valid.filter(item => item.entityType === 'volcano')
      const globalEvents = valid.filter(item => item.entityType === 'natural_event').sort((a, b) => {
        const dateA = Date.parse(String(a.attributes?.eventDate ?? a.observedAt ?? '')) || 0
        const dateB = Date.parse(String(b.attributes?.eventDate ?? b.observedAt ?? '')) || 0
        return dateB - dateA
      })
      const earthquakes = valid.filter(item => item.entityType === 'earthquake').sort((a, b) => {
        const ma = Number(a.attributes?.magnitude)
        const mb = Number(b.attributes?.magnitude)
        return (Number.isFinite(mb) ? mb : 0) - (Number.isFinite(ma) ? ma : 0)
      })
      const zoom = map.getZoom()
      const earthquakeLimit = zoom < 2 ? 24 : zoom < 4 ? 48 : 100
      const globalEventLimit = zoom < 2 ? 12 : zoom < 4 ? 26 : 50
      const visible = [...volcanoes, ...globalEvents.slice(0, globalEventLimit), ...earthquakes.slice(0, earthquakeLimit)]

      for (const item of visible) {
        const element = makeNaturalEventMarker(item, entity => onNaturalEventSelectRef.current?.(entity))
        const marker = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([item.longitude, item.latitude])
          .addTo(map)
        marker.getElement().style.zIndex = item.entityType === 'earthquake' ? '72' : item.entityType === 'natural_event' ? '66' : '68'
        naturalEventMarkersRef.current.set(item.id, marker)
      }
    }
    renderEvents()
    map.on('zoomend', renderEvents)
    return () => {
      map.off('zoomend', renderEvents)
      for (const marker of naturalEventMarkersRef.current.values()) marker.remove()
      naturalEventMarkersRef.current.clear()
    }
  }, [mapReady, weatherAnimationEnabled, naturalEvents])

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
      @keyframes lf-weather-signal{0%{transform:scale(.88);opacity:0}12%{opacity:.20}42%{opacity:.11}100%{transform:scale(1.52);opacity:0}}
      .lf-weather-marker{position:relative;width:40px;height:40px;display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--weather-color);overflow:visible;cursor:pointer;isolation:isolate;appearance:none;-webkit-tap-highlight-color:transparent;transition:background .18s ease,transform .18s ease}
      .lf-weather-marker:hover{background:rgba(4,9,17,.12)}
      .lf-weather-marker:focus-visible{outline:2px solid color-mix(in srgb,var(--weather-color) 82%,white 18%);outline-offset:2px}
      .lf-weather-core{position:relative;z-index:2;display:grid;place-items:center;width:27px;height:27px;border-radius:9px;background:linear-gradient(155deg,rgba(17,26,39,.97),rgba(4,8,15,.98));border:1px solid rgba(231,241,252,.24);box-shadow:0 2px 6px rgba(0,0,0,.43),inset 0 1px 0 rgba(255,255,255,.12);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
      .lf-weather-core:before{content:"";position:absolute;inset:2px;border:1px solid color-mix(in srgb,var(--weather-color) 30%,transparent);border-radius:6px;pointer-events:none}
      .lf-weather-core svg{position:relative;width:16px;height:16px;color:var(--weather-color);filter:none;overflow:visible}
      .lf-weather-core svg{z-index:1}
      .lf-weather-fx{position:absolute;z-index:2;inset:0;overflow:hidden;border-radius:9px;pointer-events:none}
      .lf-weather-fx-rain i{position:absolute;top:10px;width:1.5px;height:5px;border-radius:2px;background:var(--weather-color);opacity:0;animation:lf-weather-rain-drop 1.05s linear infinite}
      .lf-weather-fx-rain i:nth-child(1){left:6px;animation-delay:-.6s}
      .lf-weather-fx-rain i:nth-child(2){left:13px;animation-delay:-.12s}
      .lf-weather-fx-rain i:nth-child(3){left:20px;animation-delay:-.82s}
      .lf-weather-marker[data-condition*="drizzle"] .lf-weather-fx-rain i{animation-duration:1.9s;opacity:.56}
      .lf-weather-fx-snow i{position:absolute;top:8px;width:2.5px;height:2.5px;border-radius:50%;background:#e3f4ff;opacity:0;animation:lf-weather-snow-drift 2.2s ease-in-out infinite}
      .lf-weather-fx-snow i:nth-child(1){left:7px;animation-delay:-.8s}
      .lf-weather-fx-snow i:nth-child(2){left:14px;animation-delay:-1.6s}
      .lf-weather-fx-snow i:nth-child(3){left:21px;animation-delay:-.25s}
      .lf-weather-fx-fog i{position:absolute;left:-4px;width:35px;height:1px;background:color-mix(in srgb,var(--weather-color) 68%,white);opacity:0;animation:lf-weather-fog-drift 4.4s ease-in-out infinite}
      .lf-weather-fx-fog i:first-child{top:11px}
      .lf-weather-fx-fog i:last-child{top:18px;animation-delay:-2.2s}
      .lf-weather-fx-storm{inset:2px;border-radius:7px;background:rgba(255,235,195,.12);opacity:0;animation:lf-weather-storm-flash 7.6s steps(1,end) infinite}
      @keyframes lf-weather-rain-drop{0%{transform:translateY(-5px) rotate(18deg);opacity:0}22%{opacity:.62}100%{transform:translateY(9px) rotate(18deg);opacity:0}}
      @keyframes lf-weather-snow-drift{0%{transform:translate(0,-4px);opacity:0}28%{opacity:.8}100%{transform:translate(3px,11px);opacity:0}}
      @keyframes lf-weather-fog-drift{0%,100%{transform:translateX(-3px);opacity:.13}50%{transform:translateX(4px);opacity:.46}}
      @keyframes lf-weather-storm-flash{0%,9%,100%{opacity:0}9.3%{opacity:.28}10%{opacity:.04}10.3%{opacity:.18}11%{opacity:0}}

      .lf-weather-marker:hover .lf-weather-core,.lf-weather-marker:focus-visible .lf-weather-core{transform:translateY(-1px);border-color:color-mix(in srgb,var(--weather-color) 64%,white 14%);box-shadow:0 4px 10px rgba(0,0,0,.46),inset 0 1px 0 rgba(255,255,255,.16)}
      .lf-weather-ripple{position:absolute;z-index:1;inset:0;border:1px solid color-mix(in srgb,var(--weather-color) 54%,transparent);border-radius:13px;pointer-events:none;opacity:0;transform-origin:center;animation:lf-weather-signal 5.8s cubic-bezier(.16,1,.3,1) infinite;animation-delay:var(--weather-delay,0s)}
      .lf-weather-marker[data-freshness="DELAYED"] .lf-weather-ripple{animation-duration:8.2s;border-style:dashed}
      .lf-weather-label{position:absolute;z-index:4;top:32px;left:50%;transform:translate(-50%,3px);opacity:0;display:flex;align-items:center;gap:7px;max-width:180px;padding:5px 8px;border:1px solid color-mix(in srgb,var(--weather-color) 30%,rgba(255,255,255,.12));border-radius:8px;background:rgba(4,9,16,.96);box-shadow:0 8px 24px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(10px);font:700 8px/1.15 "IBM Plex Mono",monospace;white-space:nowrap;pointer-events:none;transition:opacity .16s ease,transform .16s ease}
      .lf-weather-label b{max-width:115px;overflow:hidden;text-overflow:ellipsis;color:#e7edf5;letter-spacing:.045em}
      .lf-weather-label i{font-style:normal;padding-left:7px;border-left:1px solid rgba(255,255,255,.16);color:#f2d38b;font-weight:800}
      .lf-weather-marker:hover .lf-weather-label,.lf-weather-marker:focus-visible .lf-weather-label{opacity:1;transform:translate(-50%,0)}
      .lf-weather-marker[data-freshness="STALE"] .lf-weather-core,.lf-weather-marker[data-freshness="UNKNOWN"] .lf-weather-core,.lf-weather-marker[data-freshness="EXPIRED"] .lf-weather-core,.lf-weather-marker[data-freshness="UNAVAILABLE"] .lf-weather-core{opacity:.58;border-color:rgba(219,228,239,.13);box-shadow:0 1px 3px rgba(0,0,0,.28)}
      .lf-weather-marker[data-freshness="STALE"] .lf-weather-ripple,.lf-weather-marker[data-freshness="UNKNOWN"] .lf-weather-ripple,.lf-weather-marker[data-freshness="EXPIRED"] .lf-weather-ripple,.lf-weather-marker[data-freshness="UNAVAILABLE"] .lf-weather-ripple{animation:none;opacity:0}
      .lf-weather-marker[data-freshness="DELAYED"] .lf-weather-core{border-style:dashed}
      @keyframes lf-natural-event-pulse{0%{transform:scale(.9);opacity:0}15%{opacity:.18}48%{opacity:.08}100%{transform:scale(1.5);opacity:0}}
      .lf-natural-event-marker{position:relative;width:38px;height:38px;display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--event-color);overflow:visible;cursor:pointer;isolation:isolate;appearance:none;-webkit-tap-highlight-color:transparent}
      .lf-natural-event-marker:focus-visible{outline:2px solid color-mix(in srgb,var(--event-color) 82%,white 18%);outline-offset:2px}
      .lf-natural-event-core{position:relative;z-index:2;display:grid;place-items:center;width:26px;height:26px;border-radius:9px;background:linear-gradient(155deg,rgba(17,25,36,.97),rgba(4,8,14,.98));border:1px solid color-mix(in srgb,var(--event-color) 44%,rgba(255,255,255,.28));box-shadow:0 2px 6px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.1)}
      .lf-natural-event-core svg{width:17px;height:17px;color:var(--event-color)}
      .lf-natural-event-pulse{position:absolute;inset:0;border:1px solid color-mix(in srgb,var(--event-color) 62%,transparent);border-radius:12px;opacity:0;pointer-events:none;animation:lf-natural-event-pulse 6.4s cubic-bezier(.16,1,.3,1) infinite;animation-delay:var(--event-delay,0s)}
      .lf-natural-event-marker[data-event-type="volcano"] .lf-natural-event-pulse{animation-duration:9s;border-style:dashed}
      .lf-natural-event-marker[data-event-type="natural-event"] .lf-natural-event-pulse{animation-duration:8s;border-style:dotted}
      .lf-natural-event-label{position:absolute;z-index:4;top:32px;left:50%;transform:translate(-50%,3px);opacity:0;display:flex;align-items:center;gap:6px;max-width:210px;padding:5px 7px;border:1px solid color-mix(in srgb,var(--event-color) 26%,rgba(255,255,255,.12));border-radius:7px;background:rgba(4,9,16,.96);box-shadow:0 8px 24px rgba(0,0,0,.32);font:700 8px/1.15 "IBM Plex Mono",monospace;white-space:nowrap;pointer-events:none;transition:opacity .16s ease,transform .16s ease}
      .lf-natural-event-label b{color:#e7edf5;letter-spacing:.045em}
      .lf-natural-event-label i{font-style:normal;padding-left:6px;border-left:1px solid rgba(255,255,255,.15);color:var(--event-color)}
      .lf-natural-event-marker:hover .lf-natural-event-label,.lf-natural-event-marker:focus-visible .lf-natural-event-label{opacity:1;transform:translate(-50%,0)}
      .lf-natural-event-marker[data-freshness="STALE"] .lf-natural-event-core{opacity:.5}
      @media(prefers-reduced-motion:reduce){.lf-natural-event-pulse,.lf-natural-event-marker,.lf-natural-event-label{animation:none!important;transition:none!important}.lf-natural-event-pulse{display:none}}
      @media(prefers-reduced-motion:reduce){.lf-weather-core,.lf-weather-ripple,.lf-weather-marker,.lf-weather-label,.lf-weather-fx,.lf-weather-fx *{animation:none!important;transition:none!important}.lf-weather-ripple,.lf-weather-fx{display:none}}
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
          <button
            onClick={() => setTrafficOn(v => !v)}
            title={trafficOn ? 'Hide traffic (congestion + incidents)' : 'Show traffic (congestion + incidents) — coverage is sparse or absent in some conflict corridors'}
            style={{ width: 34, height: 34, borderRadius: 7, background: trafficOn ? 'rgba(239,68,68,.18)' : 'rgba(8,11,20,.92)', border: `1px solid ${trafficOn ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.11)'}`, color: trafficOn ? '#ef4444' : '#7a7e8a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="20" rx="1"/><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>
          </button>
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
