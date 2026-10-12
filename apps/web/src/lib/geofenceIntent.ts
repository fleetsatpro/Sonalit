/**
 * Route only deliberately manual or unanchored drawing requests to the click-map
 * editor. A named place or route should be executed autonomously; polygon wording
 * alone must not force the user to place vertices by hand.
 */
export function shouldOpenManualPolygonDrawing(command: string): boolean {
  const text = String(command || '').trim();
  if (!text) return false;

  // Explicit editor/vertex-placement requests should work even when the user
  // does not repeat the word "geofence" in that message.
  const explicitlyOpeningEditor = /\b(open\s+(?:the\s+)?drawing editor|interactive drawing|place\s+(?:the\s+)?vertices|let me draw)\b/i.test(text);
  if (explicitlyOpeningEditor) return true;

  const hasDrawVerb = /\b(draw|sketch|outline|create|make|build|define|set\s+up)\b/i.test(text);
  const hasGeofenceIntent = /\b(geo[- ]?fence|fence|zone|boundary|area|polygon)\b/i.test(text);
  if (!hasDrawVerb || !hasGeofenceIntent) return false;

  const explicitlyManual = /\b(manually|manual|by hand|click\s+(?:the\s+)?map)\b/i.test(text);
  if (explicitlyManual) return true;

  const hasLocationOrRoute = /\b(?:around|near|at|from|between|along|within|in|for)\s+\S+/i.test(text)
    || /\b-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+\b/.test(text);
  return !hasLocationOrRoute;
}
