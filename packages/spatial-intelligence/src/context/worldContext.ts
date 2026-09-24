/**
 * World Context — shared backbone for map, Copilot, Intelligence and Route Safety.
 */

import type { SpatialObservation } from '../model/observation.js';

export type WorldContextSubjectKind =
  | 'convoy' | 'vehicle' | 'route' | 'corridor' | 'incident'
  | 'checkpoint' | 'port' | 'location' | 'none';

export interface WorldContextSubject {
  kind: WorldContextSubjectKind;
  id: string;
  label?: string;
  orgId: string;
}

export interface WorldContextQuery {
  subject: WorldContextSubject;
  center?: { latitude: number; longitude: number };
  radiusM?: number;
  route?: { coordinates: [number, number][] };
  corridorId?: string;
  timeWindow?: { from: string; to: string };
  layers?: string[];
  maxEntitiesPerLayer?: number;
  tenant: { orgId: string; userId?: string; roles?: string[] };
}

export interface WorldContextLayerHealth {
  layerId: string;
  status:
    | 'LIVE' | 'DELAYED' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE'
    | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'COVERAGE_LIMITED';
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  recordCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  freshnessMs?: number;
  sampleCount?: number;
  successfulSamples?: number;
  failedSamples?: number;
  coverageComplete?: boolean;
  reason?: string;
}

export type WorldContextRelationPredicate =
  | 'NEAR' | 'WITHIN' | 'INTERSECTS' | 'CONTAINS' | 'CROSSES'
  | 'APPROACHING' | 'DEPARTING' | 'OVERLAPS_IN_TIME' | 'OVERLAPS_IN_SPACE'
  | 'ON_ROUTE' | 'OFF_ROUTE' | 'WITHIN_CORRIDOR' | 'OUTSIDE_CORRIDOR'
  | 'NEAR_CHECKPOINT' | 'CHECKPOINT_APPROACH' | 'CHECKPOINT_PASSED'
  | 'NEAR_INCIDENT' | 'HAZARD_NEAR_ROUTE'
  | 'NEAR_TRAFFIC' | 'TRAFFIC_CONGESTION' | 'TRAFFIC_CLOSURE'
  | 'EXTERNAL_INCIDENT_NEAR_ROUTE' | 'EXTERNAL_HAZARD_NEAR_ROUTE' | 'NATURAL_HAZARD_NEAR_ROUTE'
  | 'NEAR_MARITIME' | 'APPROACHING_DESTINATION' | 'VESSEL_APPROACHING_DESTINATION'
  | 'AHEAD' | 'BEHIND' | 'PARALLEL' | 'CROSSING';

export interface WorldContextEvidence {
  metric: string;
  value: unknown;
  source?: string;
}

export interface WorldContextRelation {
  predicate: WorldContextRelationPredicate | string;
  fromId: string;
  toId: string;
  fromType?: string;
  toType?: string;
  distanceM?: number | null;
  routeDistanceM?: number | null;
  relativeDirection?: string;
  confidence?: number;
  operationalConfidence?: number;
  observedAt?: string | null;
  derivedAt: string;
  evidence?: WorldContextEvidence[];
  sourceReferences?: string[];
  uncertainty?: string[];
  relevance?: {
    score: number;
    components: Record<string, number>;
  };
  actionable?: boolean;
  temporal?: {
    from?: string | null;
    to?: string | null;
  };
}

export interface SpatialEvent {
  id?: string;
  eventKey: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  convoyId?: string | null;
  relatedEntities: Array<Record<string, unknown>>;
  previousState?: string | null;
  newState?: string | null;
  observedAt?: string | null;
  detectedAt: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  operationalConfidence?: number;
  evidence: WorldContextEvidence[];
  sourceReferences: string[];
  uncertainty: string[];
  ruleVersion: string;
  status: 'open' | 'resolved' | 'suppressed';
}

export interface WorldContextMission {
  convoyId?: string | null;
  name?: string | null;
  status?: string | null;
  priority?: string | null;
  origin?: string | null;
  destination?: string | null;
  departureTime?: string | null;
  estimatedArrival?: string | null;
  route?: { coordinates: [number, number][]; lengthKm?: number };
  corridor?: { widthKm: number; active: boolean };
}

export interface WorldContextOperationalVehicle extends SpatialObservation {
  convoyId?: string | null;
  positionSource?: string;
  previousObservedAt?: string | null;
  historyGapMs?: number | null;
  impliedSpeedKmh?: number | null;
  headingDeltaDeg?: number | null;
  stationaryDurationMs?: number | null;
  recoveredFreshness?: boolean;
  previousFreshnessClass?: 'LIVE' | 'DELAYED' | 'STALE' | 'UNKNOWN';
  routeState?: {
    relation: string;
    crossTrackKm?: number | null;
    alongKm?: number | null;
    expectedAlongKm?: number | null;
    routeProgressPct?: number | null;
    scheduleDeltaKm?: number | null;
    scheduleDeltaMin?: number | null;
    corridorKm?: number | null;
  };
  previousRouteState?: {
    relation: string;
    crossTrackKm?: number | null;
    alongKm?: number | null;
  };
  nearbyCheckpoints?: Array<{
    id: string;
    label: string;
    distanceM: number;
    previousDistanceM?: number | null;
    approachDeltaM?: number | null;
    approaching?: boolean;
    passed?: boolean;
    expectedAt?: string | null;
    status?: string | null;
    uncertainty?: string[];
  }>;
  uncertainty?: string[];
}

export interface WorldContextOperational {
  vehicles: WorldContextOperationalVehicle[];
  alerts: Array<Record<string, unknown>>;
}

export interface WorldContextResult {
  subject: WorldContextSubject;
  generatedAt: string;
  spatialContext: {
    center?: { latitude: number; longitude: number };
    radiusM?: number;
    queryScope: string;
    corridorKm?: number;
    routeQueryPlan?: {
      mode: 'center_only' | 'single_aoi' | 'multi_aoi' | string;
      reason: string;
      maxAois: number;
      segmentsPlanned: number;
      routeLengthKm: number;
      routeLengthCoveredM: number;
      coverageRatio: number;
      aois: Array<{
        id: string;
        bbox: [number, number, number, number];
        fromIndex: number;
        toIndex: number;
        routeLengthKm: number;
      }>;
      samplePoints: Array<{ latitude: number; longitude: number }>;
    };
  };
  mission?: WorldContextMission;
  operational?: WorldContextOperational;
  entities: SpatialObservation[];
  relations: WorldContextRelation[];
  environment: SpatialObservation[];
  movement: SpatialObservation[];
  traffic: SpatialObservation[];
  hazards: SpatialObservation[];
  infrastructure: SpatialObservation[];
  security: SpatialObservation[];
  events?: SpatialEvent[];
  coverage: {
    layersRequested: string[];
    layersSucceeded: string[];
    layersPartial: string[];
    layersUnavailable: string[];
    route?: {
      mode: string;
      reason: string;
      aoisPlanned: number;
      maxAois: number;
      segmentsPlanned: number;
      routeLengthKm: number;
      routeLengthCoveredM: number;
      coverageRatio: number;
    };
  };
  layerHealth: WorldContextLayerHealth[];
  providerCoverage?: Record<string, {
    complete: boolean;
    routeCoverageRatio?: number;
    routeLengthCoveredM?: number;
    aoisPlanned?: number;
    aoisSucceeded?: number;
    aoisFailed?: number;
    sampleCount?: number;
    successfulSamples?: number;
    failedSamples?: number;
    [key: string]: unknown;
  }>;
  providerHealth?: Record<string, {
    provider?: string;
    capabilities?: string[];
    status?: string;
    reason?: string;
    lastSuccessAt?: string | null;
    lastAttemptAt?: string | null;
    manager?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  provenance: Array<{ sourceName: string; attribution?: string; license?: string }>;
  freshness: {
    oldestObservedAt?: string;
    newestObservedAt?: string;
  };
  uncertainty: string[];
  warnings: string[];
  dataHealth?: {
    ok: boolean;
    readErrors: Array<{ message: string; code?: string | null }>;
  };
}

export function suggestContextRadiusM(opts: {
  convoySpeedMps?: number | null;
  routeLengthM?: number | null;
  corridorClass?: string;
  scenario?: 'immediate' | 'local' | 'regional' | 'broad';
}): number {
  const scenario = opts.scenario ?? 'local';
  const base: Record<string, number> = {
    immediate: 5_000,
    local: 25_000,
    regional: 100_000,
    broad: 250_000,
  };
  let r = base[scenario] ?? 25_000;
  if (opts.convoySpeedMps && opts.convoySpeedMps > 20) r = Math.min(r * 1.4, 300_000);
  if (opts.routeLengthM && opts.routeLengthM > 200_000) {
    r = Math.min(Math.max(r, opts.routeLengthM * 0.15), 350_000);
  }
  return Math.round(r);
}
