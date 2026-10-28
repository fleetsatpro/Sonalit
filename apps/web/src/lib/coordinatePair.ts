export type LngLatCoordinate = [number, number];

function numericCoordinate(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Converts a coordinate pair into MapLibre's [longitude, latitude] order.
 * Empty fields are rejected rather than coerced to 0 by Number('').
 * The null island (0, 0) is rejected because it is commonly a missing-data sentinel.
 */
export function toCoordinatePair(latValue: unknown, lngValue: unknown): LngLatCoordinate | null {
  const lat = numericCoordinate(latValue);
  const lng = numericCoordinate(lngValue);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return null;
  return [lng, lat];
}
