/**
 * World-signal provider contract for Sonalit backend gateway.
 */

import type { SpatialObservation, FreshnessClass } from '../model/observation.js';

export type ProviderFailureClass =
  | 'timeout' | 'cancelled' | 'rate_limited' | 'auth_required' | 'http_error'
  | 'malformed' | 'invalid_data' | 'empty' | 'partial' | 'stale'
  | 'coverage_limited' | 'budget_exhausted' | 'circuit_open'
  | 'unavailable' | 'unknown';

export interface ProviderHealth {
  providerId: string;
  status: FreshnessClass | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'COVERAGE_LIMITED';
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastErrorClass?: ProviderFailureClass;
  lastErrorMessage?: string;
  recordCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  cacheHitRate?: number;
  requestCount?: number;
  retryCount?: number;
}

export interface ProviderQueryBounds {
  bbox: [number, number, number, number];
  route?: { coordinates: [number, number][] };
  radiusM?: number;
  center?: { latitude: number; longitude: number };
}

export interface ProviderQuery {
  bounds: ProviderQueryBounds;
  timeWindow?: { from: string; to: string };
  maxRecords?: number;
  signal?: AbortSignal;
  tenant: { orgId: string };
  requestId?: string;
}

export interface ProviderResult {
  observations: SpatialObservation[];
  health: ProviderHealth;
  coverage: {
    complete: boolean;
    queryComplete?: boolean;
    plannedCoverageComplete?: boolean;
    routeCoverageRatio?: number;
    plannedRouteCoverageRatio?: number;
    routeLengthCoveredM?: number;
    aoisPlanned?: number;
    aoisSucceeded?: number;
    aoisFailed?: number;
    sampleCount?: number;
    successfulSamples?: number;
    failedSamples?: number;
    omittedCount?: number;
    queryScope: string;
    [key: string]: unknown;
  };
  cache?: { hit: boolean; ageMs?: number };
}

export interface WorldSignalProvider {
  readonly id: string;
  readonly displayName: string;
  readonly entityTypes: string[];
  readonly requiresAuth: boolean;
  readonly maxLiveMs: number;
  fetch(query: ProviderQuery): Promise<ProviderResult>;
  getHealth(): ProviderHealth;
}

export interface ProviderBudget {
  providerId: string;
  maxRequestsPerMinute: number;
  maxRequestsPerDay?: number;
  maxConcurrent?: number;
  tenantMaxRequestsPerMinute?: number;
  tenantMaxConcurrent?: number;
  estimatedCostPerRequest?: number;
}

export const DEFAULT_BUDGETS: Record<string, ProviderBudget> = {
  opensky: {
    providerId: 'opensky',
    maxRequestsPerMinute: 60,
    maxConcurrent: 4,
    tenantMaxRequestsPerMinute: 15,
    tenantMaxConcurrent: 2,
  },
  weather: {
    providerId: 'weather',
    maxRequestsPerMinute: 120,
    maxConcurrent: 8,
    tenantMaxRequestsPerMinute: 30,
    tenantMaxConcurrent: 2,
  },
  'kpler-ais': {
    providerId: 'kpler-ais',
    maxRequestsPerMinute: 60,
    maxConcurrent: 4,
    tenantMaxRequestsPerMinute: 15,
    tenantMaxConcurrent: 2,
  },
  'mapbox-traffic': {
    providerId: 'mapbox-traffic',
    maxRequestsPerMinute: 60,
    maxConcurrent: 6,
    tenantMaxRequestsPerMinute: 15,
    tenantMaxConcurrent: 2,
  },
  'tomtom-traffic-incidents': {
    providerId: 'tomtom-traffic-incidents',
    maxRequestsPerMinute: 60,
    maxConcurrent: 6,
    tenantMaxRequestsPerMinute: 15,
    tenantMaxConcurrent: 2,
  },
  'tomtom-traffic-flow': {
    providerId: 'tomtom-traffic-flow',
    maxRequestsPerMinute: 60,
    maxConcurrent: 6,
    tenantMaxRequestsPerMinute: 15,
    tenantMaxConcurrent: 2,
  },
  'nasa-eonet': {
    providerId: 'nasa-eonet',
    maxRequestsPerMinute: 30,
    maxConcurrent: 4,
    tenantMaxRequestsPerMinute: 7,
    tenantMaxConcurrent: 2,
  },
  cctv: {
    providerId: 'cctv',
    maxRequestsPerMinute: 60,
    maxConcurrent: 4,
    tenantMaxRequestsPerMinute: 15,
    tenantMaxConcurrent: 2,
  },
  'usgs-earthquake': {
    providerId: 'usgs-earthquake',
    maxRequestsPerMinute: 30,
    maxConcurrent: 2,
    tenantMaxRequestsPerMinute: 8,
    tenantMaxConcurrent: 1,
  },
  'nasa-firms': {
    providerId: 'nasa-firms',
    maxRequestsPerMinute: 20,
    maxConcurrent: 2,
    tenantMaxRequestsPerMinute: 5,
    tenantMaxConcurrent: 1,
  },
};
