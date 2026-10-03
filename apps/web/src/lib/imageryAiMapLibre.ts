import maplibregl from 'maplibre-gl'
import {
  enhanceImageBitmap,
  isImageryAiEnabled,
  preferredImageryAiScaleForZoom,
  shouldEnhanceRasterZoom,
} from './imageryAi.js'

const AI_PROTOCOL = 'sonalit-ai'
const SATELLITE_TEMPLATE =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const EARTH_TEMPLATE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'
const EARTH_DATE = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

let installed = false

function sourceUrl(kind: string, z: number, x: number, y: number) {
  if (kind === 'earth') {
    return EARTH_TEMPLATE
      .replace('{date}', EARTH_DATE)
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
  }
  return SATELLITE_TEMPLATE
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
}

function parseProtocol(url: string) {
  const cleaned = url.replace(/^sonalit-ai:\/\//, '')
  const parts = cleaned.split('/').filter(Boolean)
  const kind = parts[0] === 'earth' ? 'earth' : 'satellite'
  const z = Number(parts[1])
  const y = Number(parts[2])
  const x = Number(parts[3])
  if (![z, y, x].every(Number.isFinite)) return null
  return { kind, z, x, y }
}

export function aiTileUrl(kind: 'satellite' | 'earth', z: number, y: number, x: number) {
  return `${AI_PROTOCOL}://${kind}/${z}/${y}/${x}`
}

export function installImageryAiMapLibreProtocol() {
  if (installed) return
  installed = true

  maplibregl.addProtocol(AI_PROTOCOL, async params => {
    const parsed = parseProtocol(params.url)
    if (!parsed) throw new Error('Invalid Sonalit imagery AI tile URL')

    const response = await fetch(sourceUrl(parsed.kind, parsed.z, parsed.x, parsed.y), {
      signal: params.abortController?.signal,
      cache: 'force-cache',
      credentials: 'omit',
    })
    if (!response.ok) throw new Error(`Imagery source returned ${response.status}`)

    const blob = await response.blob()
    if (!isImageryAiEnabled() || !shouldEnhanceRasterZoom(parsed.z)) {
      return { data: await blob.arrayBuffer() }
    }

    try {
      const bitmap = await createImageBitmap(blob)
      const enhanced = await enhanceImageBitmap(bitmap, preferredImageryAiScaleForZoom(parsed.z))
      if (enhanced) {
        bitmap.close()
        return { data: enhanced }
      }
      const fallback = await createImageBitmap(blob)
      bitmap.close()
      return { data: fallback }
    } catch {
      return { data: await blob.arrayBuffer() }
    }
  })
}
