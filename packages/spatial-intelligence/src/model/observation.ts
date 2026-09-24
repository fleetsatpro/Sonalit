/**
 * Canonical SpatialObservation model for Sonalit Worldview.
 *
 * Design rules (non-negotiable):
 * - Freshness is NOT truth.
 * - Never convert missing timestamps to receipt time silently.
 * - Never convert unknown to zero.
 * - Never mark STALE as LIVE.
 * - Every external observation carries provenance + quality + coverage.
 * - Operational Sonalit entities remain Sonalit-owned.
 */

export type QualityState =
  | 'good'
  | 'degraded'
  | 'stale'
  | 'partial'
  | 'unknown'
  | 'rejected';

export type FreshnessClass =
  | 'LIVE'
  | 'DELAYED'
  | 'STALE'
  | 'PARTIAL'
  | 'UNAVAILABLE'
  | 'MODELLED'
  | 'INFERRED'
  | 'UNKNOWN';

export interface SpatialProvenance {
  sourceName: string;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
  observationType?: string;
  sourceReference?: string;
}

export interface SpatialCoverage {
  complete?: boolean;
  bounded?: boolean;
  omittedCount?: number;
  queryScope?: string;
  boundsDescription?: string;
}

export interface SpatialQuality {
  state: QualityState;
  reason?: string;
  freshnessClass: FreshnessClass;
}

export interface SpatialObservation {
  id: string;
  entityType: string;
  source: string;
  sourceReference?: string;
  latitude: number;
  longitude: number;
  altitudeM?: number | null;
  observedAt: string | null;
  receivedAt: string;
  freshnessMs?: number;
  accuracyM?: number | null;
  confidence?: number | null;
  headingDeg?: number | null;
  speedMps?: number | null;
  geometry?: unknown;
  status?: string;
  attributes: Record<string, unknown>;
  provenance: SpatialProvenance;
  coverage?: SpatialCoverage;
  quality: SpatialQuality;
}

export function classifyFreshness(
  observedAtIso: string | null | undefined,
  receivedAtIso: string,
  options?: { maxLiveMs?: number; maxDelayedMs?: number },
): FreshnessClass {
  if (!observedAtIso) return 'UNKNOWN';
  const observed = Date.parse(observedAtIso);
  const received = Date.parse(receivedAtIso);
  if (!Number.isFinite(observed) || !Number.isFinite(received)) return 'UNKNOWN';
  const ageMs = Math.max(0, received - observed);
  const maxLive = options?.maxLiveMs ?? 30_000;
  const maxDelayed = options?.maxDelayedMs ?? 300_000;
  if (ageMs <= maxLive) return 'LIVE';
  if (ageMs <= maxDelayed) return 'DELAYED';
  return 'STALE';
}

export function buildQuality(
  freshnessClass: FreshnessClass,
  extras?: { state?: QualityState; reason?: string },
): SpatialQuality {
  let state: QualityState = extras?.state ?? 'unknown';
  if (!extras?.state) {
    switch (freshnessClass) {
      case 'LIVE': state = 'good'; break;
      case 'DELAYED': state = 'degraded'; break;
      case 'STALE': state = 'stale'; break;
      case 'PARTIAL': state = 'partial'; break;
      case 'UNAVAILABLE':
      case 'UNKNOWN': state = 'unknown'; break;
      case 'MODELLED':
      case 'INFERRED': state = 'degraded'; break;
    }
  }
  return { state, freshnessClass, reason: extras?.reason };
}

export function isValidLatLon(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}
