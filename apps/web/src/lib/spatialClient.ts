import type { AxiosRequestConfig } from 'axios'
import { api } from './api.js'

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
      layers: (input.layers ?? ['aircraft', 'maritime', 'hazards', 'satellites']).join(','),
      maxEntitiesPerLayer: Math.min(Math.max(input.maxEntitiesPerLayer ?? 75, 1), 250),
      ...(input.subject ? { subject: JSON.stringify(input.subject) } : {}),
    },
  }
  const response = await api.get<{ data: SpatialWorldContext }>('/spatial/world-context', config)
  return response.data.data
}

export function externalWorldFeatures(context: SpatialWorldContext | undefined): GeoJSON.FeatureCollection<GeoJSON.Point, Record<string, unknown>> {
  const observations = [
    ...(context?.movement ?? []),
    ...(context?.traffic ?? []),
    ...(context?.hazards ?? []),
    ...(context?.satellites ?? []),
  ]

  const features = observations
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .filter((item) => ['aircraft', 'vessel', 'natural_hazard', 'traffic_incident', 'traffic_hazard', 'traffic_segment', 'satellite'].includes(item.entityType))
    .map((item) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [item.longitude, item.latitude] as [number, number],
      },
      properties: {
        id: item.id,
        kind: item.entityType,
        label: String(item.attributes?.callsign ?? item.attributes?.name ?? item.attributes?.title ?? item.attributes?.categoryTitle ?? item.attributes?.description ?? item.id),
        status: item.status ?? '',
        source: item.source ?? '',
        freshness: item.quality?.freshnessClass ?? 'UNKNOWN',
        observedAt: item.observedAt ?? null,
        confidence: item.observationConfidence ?? item.operationalConfidence ?? null,
        telemetryLive: item.telemetryLive ?? (item.entityType === 'satellite' ? false : null),
        imagingClaim: item.imagingClaim ?? (item.entityType === 'satellite' ? false : null),
        taskingClaim: item.taskingClaim ?? (item.entityType === 'satellite' ? false : null),
        positionSource: item.positionSource ?? (item.entityType === 'satellite' ? 'modelled' : null),
        caption: item.entityType === 'satellite'
          ? 'modelled orbital position (not live telemetry; not an imaging claim)'
          : undefined,
      },
    }))

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
