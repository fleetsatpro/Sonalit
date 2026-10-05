import maplibregl from 'maplibre-gl'
import { api } from './api.js'
import { getAccessToken } from '../stores/auth.js'

export type OpticalCandidate = {
  id: string
  provider: string
  mission: string
  sensor?: string
  itemId?: string
  acquiredAt: string | null
  date: string | null
  cloudPct: number | null
  nativeResolutionM: number | null
  licence: string
  freshness: string
  capabilities: string[]
  score: number
  renderable: boolean
  render?: { source: 'sentinel' | 'oam' | 'nasa'; date?: string | null; itemId?: string; layer?: string } | null
  recommendation?: string
}

export type OpticalReconResult = {
  centre: { latitude: number; longitude: number }
  bbox: number[]
  generatedAt: string
  primary: OpticalCandidate
  precisionAlternative: OpticalCandidate | null
  candidates: OpticalCandidate[]
  render: { source: 'sentinel' | 'oam' | 'nasa'; date?: string | null; itemId?: string }
  quality: {
    state: string
    freshness: string
    nativeResolutionM: number
    cloudPct: number | null
    provider: string
  }
  coverage: {
    sentinel2Scenes: number
    lowCloudScenes: number
    openAerialMapCandidates: number
  }
  warnings: string[]
  semantics: string[]
}

let installed = false

export function fetchOpticalRecon(center: { latitude: number; longitude: number }, radiusM = 25_000, signal?: AbortSignal) {
  return api.get<{ data: OpticalReconResult }>('/spatial/optical-recon', {
    params: { lat: center.latitude, lng: center.longitude, radiusM },
    signal,
  }).then(r => r.data.data)
}

function baseUrl() {
  const configured = import.meta.env['VITE_API_BASE_URL']
  if (configured) return String(configured).replace(/\/$/, '')
  return '/api/v1'
}

function tileUrl(render: NonNullable<OpticalReconResult['render']>, z: number, x: number, y: number) {
  const params = new URLSearchParams({
    source: render.source,
    date: String(render.date || ''),
    z: String(z),
    x: String(x),
    y: String(y),
  })
  if (render.itemId) params.set('itemId', render.itemId)
  return baseUrl() + '/spatial/optical-recon/tile?' + params.toString()
}

function parse(url: string) {
  const cleaned = url.replace(/^sonalit-recon:\/\//, '')
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length < 5) return null
  const source = parts[0] as 'sentinel' | 'oam' | 'nasa'
  const date = decodeURIComponent(parts[1] || '')
  const z = Number(parts[2])
  const y = Number(parts[3])
  const x = Number(parts[4])
  if (!['sentinel', 'oam', 'nasa'].includes(source) || ![z, y, x].every(Number.isFinite)) return null
  const itemId = parts[5] ? decodeURIComponent(parts[5]) : undefined
  return { source, date, z, x, y, itemId }
}

export function reconStyle(render: OpticalReconResult['render']): maplibregl.StyleSpecification {
  const itemPart = render.itemId ? '/' + encodeURIComponent(render.itemId) : ''
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      recon: {
        type: 'raster',
        tiles: ['sonalit-recon://' + render.source + '/' + encodeURIComponent(String(render.date || '')) + '/{z}/{y}/{x}' + itemPart],
        tileSize: 256,
        maxzoom: render.source === 'nasa' ? 9 : 19,
        attribution: render.source === 'sentinel'
          ? 'Copernicus Sentinel-2 · Digital Earth Africa'
          : render.source === 'oam'
            ? 'OpenAerialMap / HOTOSM'
            : 'NASA EOSDIS GIBS',
      },
      ref: {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© Esri Reference Overlay',
      },
    },
    layers: [
      {
        id: 'recon-tiles',
        type: 'raster',
        source: 'recon',
        paint: { 'raster-opacity': 1, 'raster-resampling': 'linear' },
      },
      {
        id: 'recon-reference',
        type: 'raster',
        source: 'ref',
        paint: { 'raster-opacity': 0.82 },
      },
    ],
  }
}

export function installOpticalReconMapLibreProtocol() {
  if (installed) return
  installed = true
  maplibregl.addProtocol('sonalit-recon', async (params, abortController) => {
    const parsed = parse(params.url)
    if (!parsed) throw new Error('Invalid Sonalit reconnaissance tile URL')
    const response = await fetch(tileUrl({
      source: parsed.source,
      date: parsed.date,
      ...(parsed.itemId ? { itemId: parsed.itemId } : {}),
    }, parsed.z, parsed.x, parsed.y), {
      signal: abortController?.signal,
      credentials: 'include',
      headers: (() => {
        const token = getAccessToken()
        return token ? { Authorization: 'Bearer ' + token } : {}
      })(),
      cache: 'force-cache',
    })
    if (!response.ok) throw new Error('Reconnaissance tile HTTP ' + response.status)
    return { data: await response.arrayBuffer() }
  })
}
