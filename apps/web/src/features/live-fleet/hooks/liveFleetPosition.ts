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

export function isValidGpsPosition(position: Partial<LiveGpsPosition>): position is LiveGpsPosition {
  const lat = Number(position.lat);
  const lng = Number(position.lng);
  return !!position.device_id &&
    Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function gpsFixEpoch(position: Pick<LiveGpsPosition, 'timestamp'>): number {
  if (!position.timestamp) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(position.timestamp);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export function preferNewerGpsPosition(
  current: LiveGpsPosition | undefined,
  candidate: LiveGpsPosition,
): LiveGpsPosition {
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

export function indexLatestGpsPositions(rows: readonly LiveGpsPosition[]): Map<string, LiveGpsPosition> {
  const latest = new Map<string, LiveGpsPosition>();
  for (const row of rows) {
    if (!isValidGpsPosition(row)) continue;
    const key = row.vehicle_id || row.device_id;
    latest.set(key, preferNewerGpsPosition(latest.get(key), row));
  }
  return latest;
}

/**
 * Replace the polling snapshot, but do not let an HTTP response that started
 * before a websocket event roll a device back to an older position.
 */
export function mergeGpsSnapshotWithRealtime(
  snapshot: Map<string, LiveGpsPosition>,
  previous: Map<string, LiveGpsPosition>,
  requestStartedAt: number,
): Map<string, LiveGpsPosition> {
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
