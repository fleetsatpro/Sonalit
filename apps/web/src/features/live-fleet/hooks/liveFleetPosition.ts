export interface LiveGpsPosition {
  device_id: string;
  vehicle_id: string | null;
  lat: number;
  lng: number;
  timestamp: string | null;
  accuracy_m?: number | null;
  speed?: number | null;
  heading?: number | null;
  _receivedAt?: number;
  [key: string]: unknown;
}

function finiteCoordinate(value: unknown): number | null {
  // Numeric strings are expected from PostgreSQL NUMERIC columns, but null,
  // blank strings, booleans and other coercible values are not coordinates.
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeGpsPosition<T extends Partial<LiveGpsPosition>>(
  position: T,
): (T & LiveGpsPosition) | null {
  const lat = finiteCoordinate(position.lat);
  const lng = finiteCoordinate(position.lng);
  if (!position.device_id || lat === null || lat < -90 || lat > 90 ||
      lng === null || lng < -180 || lng > 180) return null;
  // PostgreSQL NUMERIC/DECIMAL columns are commonly serialized as strings.
  // Convert once at the feed boundary so map projections always receive
  // numeric coordinates; do not round the GPS source precision.
  return { ...position, lat, lng } as T & LiveGpsPosition;
}

export function isValidGpsPosition<T extends Partial<LiveGpsPosition>>(
  position: T,
): position is T & LiveGpsPosition {
  return normalizeGpsPosition(position) !== null;
}

export function gpsFixEpoch(position: Pick<LiveGpsPosition, 'timestamp'>): number {
  if (!position.timestamp) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(position.timestamp);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export function preferNewerGpsPosition<T extends LiveGpsPosition>(
  current: T | undefined,
  candidate: T,
): T {
  if (!current) return candidate;
  const currentTime = gpsFixEpoch(current);
  const candidateTime = gpsFixEpoch(candidate);
  if (candidateTime > currentTime) return candidate;
  if (candidateTime < currentTime) return current;
  const currentAccuracy = Number(current.accuracy_m);
  const candidateAccuracy = Number(candidate.accuracy_m);
  const currentHasAccuracy = Number.isFinite(currentAccuracy) && currentAccuracy >= 0;
  const candidateHasAccuracy = Number.isFinite(candidateAccuracy) && candidateAccuracy >= 0;
  if (candidateHasAccuracy && (!currentHasAccuracy || candidateAccuracy < currentAccuracy)) return candidate;
  return current;
}

export function indexLatestGpsPositions<T extends LiveGpsPosition>(rows: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const normalized = normalizeGpsPosition(row);
    if (!normalized) continue;
    const key = normalized.vehicle_id || normalized.device_id;
    latest.set(key, preferNewerGpsPosition(latest.get(key), normalized));
  }
  return latest;
}

/**
 * Replace the polling snapshot, but do not let an HTTP response that started
 * before a websocket event roll a device back to an older position.
 */
export function mergeGpsSnapshotWithRealtime<T extends LiveGpsPosition>(
  snapshot: Map<string, T>,
  previous: Map<string, T>,
  requestStartedAt: number,
): Map<string, T> {
  const merged = new Map(snapshot);
  for (const [key, previousFix] of previous) {
    if (previousFix._receivedAt == null || previousFix._receivedAt <= requestStartedAt) continue;
    const current = merged.get(key);
    const selected = preferNewerGpsPosition(current, previousFix);
    if (selected === previousFix) merged.set(key, previousFix);
  }
  return merged;
}

export function secondsSinceGpsFix(timestamp: string | null, now = Date.now()): number {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const epoch = Date.parse(timestamp);
  if (!Number.isFinite(epoch)) return Number.POSITIVE_INFINITY;
  const age = (now - epoch) / 1000;
  // A materially future-dated fix is not live evidence.
  if (age < -60) return Number.POSITIVE_INFINITY;
  return Math.max(0, age);
}

export function isRecentDeviceHeartbeat(timestamp: string | null, now = Date.now(), limitSeconds = 300): boolean {
  if (!timestamp) return false;
  const epoch = Date.parse(timestamp);
  if (!Number.isFinite(epoch)) return false;
  const age = (now - epoch) / 1000;
  return age >= -60 && age <= limitSeconds;
}
