import type { AxiosRequestConfig } from 'axios'
import { api } from './api.js'

export const WORLD_CONTEXT_LAYERS = [
  'aircraft', 'weather', 'maritime', 'traffic', 'hazards', 'security',
  'infrastructure', 'incidents', 'alerts', 'cameras', 'satellites',
] as const

export type WorldContextLayer = typeof WORLD_CONTEXT_LAYERS[number]

export type SpatialSubject =
  | { kind: 'convoy' | 'vehicle' | 'location' | 'route' | 'corridor' | 'incident' | 'checkpoint' | 'port' | 'none'; id?: string; label?: string }

export interface SpatialWorldEntity {
  id: string
  entityType: string
  source?: string
  sourceReference?: string
  latitude: number
  longitude: number
  observedAt?: string | null
  receivedAt?: string | null
  observationConfidence?: number
  operationalConfidence?: number | null
  freshnessMs?: number
  status?: string
  attributes?: Record<string, unknown>
  quality?: {
    state?: string
    freshnessClass?: string
    reason?: string
  }
  provenance?: Record<string, unknown>
  positionSource?: string
  telemetryLive?: boolean
  imagingClaim?: boolean
  taskingClaim?: boolean
  uncertainty?: string[]
}

export interface SpatialRelation {
  predicate: string
  fromId: string
  toId: string
  fromType?: string
  toType?: string
  distanceM?: number | null
  routeDistanceM?: number | null
  relativeDirection?: string | null
  confidence?: number
  operationalConfidence?: number | null
  observedAt?: string | null
  sourceReferences?: string[]
  uncertainty?: string[]
}

export interface SpatialWorldContext {
  subject?: { kind: string; id?: string; label?: string | null; orgId?: string }
  generatedAt: string
  spatialContext?: {
    center?: { latitude: number; longitude: number }
    radiusM?: number
    queryScope?: string
    corridorKm?: number
  }
  mission?: Record<string, unknown>
  operational?: { vehicles?: SpatialWorldEntity[]; alerts?: SpatialWorldEntity[] }
  entities?: SpatialWorldEntity[]
  movement?: SpatialWorldEntity[]
  environment?: SpatialWorldEntity[]
  traffic?: SpatialWorldEntity[]
  hazards?: SpatialWorldEntity[]
  infrastructure?: SpatialWorldEntity[]
  security?: SpatialWorldEntity[]
  incidents?: SpatialWorldEntity[]
  cameras?: SpatialWorldEntity[]
  satellites?: SpatialWorldEntity[]
  relations?: SpatialRelation[]
  coverage?: {
    layersRequested?: string[]
    layersSucceeded?: string[]
    layersPartial?: string[]
    layersUnavailable?: string[]
  }
  layerHealth?: Array<Record<string, unknown>>
  provenance?: Array<Record<string, unknown>>
  freshness?: {
    oldestObservedAt?: string
    newestObservedAt?: string
  }
  uncertainty?: string[]
  warnings?: string[]
  events?: Array<Record<string, unknown>>
}

export interface WorldContextQuery {
  center: { latitude: number; longitude: number }
  radiusM: number
  layers?: string[]
  maxEntitiesPerLayer?: number
  subject?: SpatialSubject
  signal?: AbortSignal
}

export async function fetchWorldContext(input: WorldContextQuery): Promise<SpatialWorldContext> {
  const config: AxiosRequestConfig = {
    signal: input.signal,
    params: {
      lat: input.center.latitude,
      lng: input.center.longitude,
      radiusM: Math.min(Math.max(input.radiusM, 1000), 250000),
      layers: (input.layers ?? [...WORLD_CONTEXT_LAYERS]).join(','),
      maxEntitiesPerLayer: Math.min(Math.max(input.maxEntitiesPerLayer ?? 75, 1), 250),
      ...(input.subject ? { subject: JSON.stringify(input.subject) } : {}),
    },
  }
  const response = await api.get<{ data: SpatialWorldContext }>('/spatial/world-context', config)
  return response.data.data
}

export function spatialEntityLayer(item: SpatialWorldEntity): WorldContextLayer | null {
  const type = String(item.entityType || '').toLowerCase()
  if (type === 'aircraft') return 'aircraft'
  if (type === 'weather') return 'weather'
  if (type === 'vessel') return 'maritime'
  if (type.startsWith('traffic_') || type === 'traffic') return 'traffic'
  if (type === 'natural_hazard' || type === 'hazard') return 'hazards'
  if (['risk_zone', 'security', 'intelligence_alert'].includes(type)) return 'security'
  if (['incident'].includes(type)) return 'incidents'
  if (['alert'].includes(type)) return 'alerts'
  if (['satellite'].includes(type)) return 'satellites'
  if (['spatial_camera', 'camera'].includes(type)) return 'cameras'
  if (['checkpoint', 'shipment_location', 'facility', 'geofence', 'guardian_device', 'infrastructure'].includes(type)) return 'infrastructure'
  return null
}

export function worldContextEntities(context: SpatialWorldContext | undefined): SpatialWorldEntity[] {
  const buckets = [
    ...(context?.movement ?? []),
    ...(context?.environment ?? []),
    ...(context?.traffic ?? []),
    ...(context?.hazards ?? []),
    ...(context?.security ?? []),
    ...(context?.incidents ?? []),
    ...(context?.operational?.alerts ?? []),
    ...(context?.infrastructure ?? []),
    ...(context?.cameras ?? []),
    ...(context?.satellites ?? []),
  ]
  const seen = new Set<string>()
  return buckets.filter((item) => {
    const id = String(item?.id ?? '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function externalWorldFeatures(context: SpatialWorldContext | undefined): GeoJSON.FeatureCollection<GeoJSON.Point, Record<string, unknown>> {
  const observations = worldContextEntities(context)

  const features = observations
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .filter((item) => [
      'aircraft', 'vessel', 'natural_hazard', 'traffic_incident', 'traffic_hazard', 'traffic_segment',
      'weather', 'incident', 'alert', 'risk_zone', 'checkpoint', 'shipment_location', 'security',
      'satellite', 'spatial_camera', 'camera', 'infrastructure',
    ].includes(item.entityType))
    .map((item) => {
      const isSat = item.entityType === 'satellite'
      const isCam = item.entityType === 'spatial_camera' || item.entityType === 'camera'
      const kind = isCam ? 'spatial_camera' : item.entityType
      const attrs = item.attributes || {}
      const label = String(
        attrs.callsign ?? attrs.name ?? attrs.title ?? attrs.categoryTitle ?? attrs.description ?? attrs.label ?? item.id,
      )
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [item.longitude, item.latitude] as [number, number],
        },
        properties: {
          id: item.id,
          kind,
          label,
          status: item.status ?? '',
          source: item.source ?? '',
          freshness: item.quality?.freshnessClass ?? (isSat ? 'MODELLED' : 'UNKNOWN'),
          observedAt: item.observedAt ?? null,
          confidence: item.observationConfidence ?? item.operationalConfidence ?? null,
          telemetryLive: isSat ? false : (item.telemetryLive ?? null),
          imagingClaim: isSat || isCam ? false : (item.imagingClaim ?? null),
          taskingClaim: isSat ? false : (item.taskingClaim ?? null),
          positionSource: isSat ? 'modelled' : (item.positionSource ?? null),
          tier: isSat ? 'orbital' : isCam ? 'observation' : 'context',
          caption: isSat
            ? 'Modelled orbital position · not live telemetry · not an imaging claim'
            : isCam
              ? 'Camera infrastructure · geometry only · not person tracking'
              : undefined,
        },
      }
    })

  const seen = new Set<string>()
  return {
    type: 'FeatureCollection',
    features: features.filter((feature) => {
      const key = String(feature.properties.id)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
  }
}
