/**
 * World-signal provider contract for Sonalit backend gateway.
 */

import type { SpatialObservation, FreshnessClass } from '../model/observation.js';

export type ProviderFailureClass =
  | 'timeout' | 'rate_limited' | 'auth_required' | 'http_error'
  | 'malformed' | 'empty' | 'partial' | 'stale' | 'coverage_limited'
  | 'cancelled' | 'unknown';

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
    omittedCount?: number;
    queryScope: string;
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
  estimatedCostPerRequest?: number;
}

export const DEFAULT_BUDGETS: Record<string, ProviderBudget> = {
  opensky: {
    providerId: 'opensky',
    maxRequestsPerMinute: 10,
    maxRequestsPerDay: 4000,
    maxConcurrent: 2,
  },
  ais: {
    providerId: 'ais',
    maxRequestsPerMinute: 6,
    maxConcurrent: 2,
  },
  weather: {
    providerId: 'weather',
    maxRequestsPerMinute: 12,
    maxConcurrent: 3,
  },
};
