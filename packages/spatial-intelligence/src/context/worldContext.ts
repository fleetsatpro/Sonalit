/**
 * World Context — shared backbone for map, Copilot, Intelligence, Route Safety.
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
  status: 'LIVE' | 'DELAYED' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'COVERAGE_LIMITED';
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  recordCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  freshnessMs?: number;
  reason?: string;
}

export interface WorldContextRelation {
  predicate:
    | 'NEAR' | 'WITHIN' | 'INTERSECTS' | 'CONTAINS' | 'CROSSES'
    | 'APPROACHING' | 'DEPARTING' | 'OVERLAPS_IN_TIME' | 'OVERLAPS_IN_SPACE'
    | 'ON_ROUTE' | 'OFF_ROUTE' | 'WITHIN_CORRIDOR' | 'NEAR_CHECKPOINT' | 'NEAR_INCIDENT';
  fromId: string;
  toId: string;
  distanceM?: number;
  confidence?: number;
  derivedAt: string;
}

export interface WorldContextResult {
  subject: WorldContextSubject;
  generatedAt: string;
  spatialContext: {
    center?: { latitude: number; longitude: number };
    radiusM?: number;
    queryScope: string;
  };
  entities: SpatialObservation[];
  relations: WorldContextRelation[];
  environment: SpatialObservation[];
  movement: SpatialObservation[];
  infrastructure: SpatialObservation[];
  security: SpatialObservation[];
  coverage: {
    layersRequested: string[];
    layersSucceeded: string[];
    layersPartial: string[];
    layersUnavailable: string[];
  };
  layerHealth: WorldContextLayerHealth[];
  provenance: Array<{ sourceName: string; attribution?: string; license?: string }>;
  freshness: { oldestObservedAt?: string; newestObservedAt?: string };
  uncertainty: string[];
  warnings: string[];
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
  if (opts.convoySpeedMps && opts.convoySpeedMps > 20) {
    r = Math.min(r * 1.4, 300_000);
  }
  if (opts.routeLengthM && opts.routeLengthM > 200_000) {
    r = Math.min(Math.max(r, opts.routeLengthM * 0.15), 350_000);
  }
  return Math.round(r);
}
