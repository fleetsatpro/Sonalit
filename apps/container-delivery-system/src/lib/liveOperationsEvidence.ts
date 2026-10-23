export interface CoordinateEvidence {
  lat: unknown;
  lng: unknown;
}

export interface TrackingFreshnessEvidence {
  position_is_live: boolean;
  tracking_health: string | null;
  last_seen: string | null;
}

export interface LiveFeedEvidence {
  isPending: boolean;
  isError: boolean;
  hasData: boolean;
  dataUpdatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCoordinateField(value: Record<string, unknown>, name: 'lat' | 'lng'): boolean {
  if (!Object.prototype.hasOwnProperty.call(value, name)) return false;
  const coordinate = value[name];
  return coordinate === null || (typeof coordinate === 'number' && Number.isFinite(coordinate));
}

/** Validate the actual JSON contract before calling a successful feed current. */
export function isValidLiveTripPayload<T>(value: unknown): value is { data: T[] } {
  if (!isRecord(value) || !Array.isArray(value.data)) return false;
  return value.data.every((item: unknown) => {
    if (!isRecord(item)) return false;
    return typeof item.id === 'string'
      && typeof item.status === 'string'
      && typeof item.phase === 'string'
      && (item.trip_number === null || typeof item.trip_number === 'string')
      && isNullableString(item.origin)
      && isNullableString(item.destination)
      && isNullableString(item.eta)
      && isNullableString(item.vehicle_reg)
      && isCoordinateField(item, 'lat')
      && isCoordinateField(item, 'lng')
      && isNullableString(item.last_seen)
      && typeof item.position_is_live === 'boolean'
      && isNullableString(item.tracking_health)
      && isNullableString(item.position_source);
  });
}

export function hasValidCoordinates<T extends CoordinateEvidence>(
  trip: T,
): trip is T & { lat: number; lng: number } {
  return typeof trip.lat === 'number'
    && Number.isFinite(trip.lat)
    && Math.abs(trip.lat) <= 90
    && typeof trip.lng === 'number'
    && Number.isFinite(trip.lng)
    && Math.abs(trip.lng) <= 180
    // Match Sonalit's existing map-coordinate guard: Null Island often means
    // a default/unset GPS location rather than an observed vehicle position.
    && !(Math.abs(trip.lat) < 0.000001 && Math.abs(trip.lng) < 0.000001);
}

export function freshnessLabel(trip: TrackingFreshnessEvidence): string {
  if (trip.position_is_live) return 'LIVE FIX';
  // The session may be live while the displayed coordinate came from a
  // different, last-known source. Never derive "LIVE FIX" from health alone.
  if (trip.tracking_health && trip.tracking_health !== 'live') {
    return trip.tracking_health.replace(/_/g, ' ').toUpperCase();
  }
  return trip.last_seen ? 'LAST KNOWN' : 'NO FIX';
}

export function ageLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Timestamp unavailable';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'Timestamp invalid';
  const ageSecondsRaw = (now - t) / 1000;
  if (ageSecondsRaw < -30) return 'Timestamp in future';
  const ageSeconds = Math.max(0, Math.floor(ageSecondsRaw));
  if (ageSeconds < 60) return ageSeconds <= 1 ? 'just now' : `${ageSeconds}s ago`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h ago`;
  return `${Math.floor(ageSeconds / 86400)}d ago`;
}

export function getLiveFeedState(
  evidence: LiveFeedEvidence,
  now = Date.now(),
  staleAfterMs = 45_000,
): 'CHECKING FEED' | 'FEED DEGRADED' | 'FEED UNAVAILABLE' | 'FEED CURRENT' | 'FEED STALE' {
  if (evidence.isPending && !evidence.hasData) return 'CHECKING FEED';
  if (evidence.isError) return evidence.hasData ? 'FEED DEGRADED' : 'FEED UNAVAILABLE';
  const ageMs = evidence.dataUpdatedAt > 0 ? now - evidence.dataUpdatedAt : Infinity;
  if (ageMs < -30_000 || ageMs > staleAfterMs || evidence.dataUpdatedAt <= 0) return 'FEED STALE';
  return 'FEED CURRENT';
}
