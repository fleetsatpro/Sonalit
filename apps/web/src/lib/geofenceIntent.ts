/**
 * Decides whether Copilot should open the interactive polygon editor instead of
 * issuing a location/routing action. A named place or origin/destination stays
 * on the deterministic geofence executor unless a custom polygon is explicit.
 */
export function shouldOpenManualPolygonDrawing(command: string): boolean {
  const text = String(command || '').trim();
  if (!text) return false;
  const hasDrawVerb = /\b(draw|sketch|outline|create|make|build|define|set\s+up)\b/i.test(text);
  const hasGeofenceIntent = /\b(geo[- ]?fence|fence|zone|boundary|area|polygon)\b/i.test(text);
  if (!hasDrawVerb || !hasGeofenceIntent) return false;

  const explicitlyCustomShape = /\b(polygon|custom\s+(?:shape|boundary|area)|area\s+boundary)\b/i.test(text);
  const hasLocationOrRoute = /\b(?:around|near|at|from|between|along)\s+\S+/i.test(text)
    || /\b-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+\b/.test(text);

  return explicitlyCustomShape || !hasLocationOrRoute;
}
