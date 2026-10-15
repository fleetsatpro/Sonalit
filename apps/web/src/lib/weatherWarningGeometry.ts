import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { OfficialWeatherWarningFeed } from './spatialClient.js';

export const OFFICIAL_WARNING_SOURCE_ID = 'sonalit-official-weather-warning-areas';
export const OFFICIAL_WARNING_FILL_LAYER_ID = 'sonalit-official-weather-warning-fill';
export const OFFICIAL_WARNING_LINE_LAYER_ID = 'sonalit-official-weather-warning-outline';

export type OfficialWarningAreaProperties = {
  alertId: string;
  title: string;
  area: string;
  severity: string;
  activeState: 'ACTIVE' | 'UPCOMING';
  feedStatus: 'AVAILABLE' | 'STALE_FALLBACK';
};

export type OfficialWarningAreaCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, OfficialWarningAreaProperties>;

const EMPTY_COLLECTION: OfficialWarningAreaCollection = { type: 'FeatureCollection', features: [] };
const MAX_WARNING_POLYGONS = 200;


const GEOMETRY_EPSILON = 1e-10;

function orientation(a: GeoJSON.Position, b: GeoJSON.Position, c: GeoJSON.Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: GeoJSON.Position, b: GeoJSON.Position, point: GeoJSON.Position): boolean {
  return point[0] >= Math.min(a[0], b[0]) - GEOMETRY_EPSILON
    && point[0] <= Math.max(a[0], b[0]) + GEOMETRY_EPSILON
    && point[1] >= Math.min(a[1], b[1]) - GEOMETRY_EPSILON
    && point[1] <= Math.max(a[1], b[1]) + GEOMETRY_EPSILON;
}

function segmentsIntersect(a: GeoJSON.Position, b: GeoJSON.Position, c: GeoJSON.Position, d: GeoJSON.Position): boolean {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  if (((o1 > GEOMETRY_EPSILON && o2 < -GEOMETRY_EPSILON) || (o1 < -GEOMETRY_EPSILON && o2 > GEOMETRY_EPSILON))
    && ((o3 > GEOMETRY_EPSILON && o4 < -GEOMETRY_EPSILON) || (o3 < -GEOMETRY_EPSILON && o4 > GEOMETRY_EPSILON))) return true;
  return (Math.abs(o1) <= GEOMETRY_EPSILON && onSegment(a, b, c))
    || (Math.abs(o2) <= GEOMETRY_EPSILON && onSegment(a, b, d))
    || (Math.abs(o3) <= GEOMETRY_EPSILON && onSegment(c, d, a))
    || (Math.abs(o4) <= GEOMETRY_EPSILON && onSegment(c, d, b));
}

function isSimpleRing(ring: GeoJSON.Position[]): boolean {
  const edgeCount = ring.length - 1;
  for (let firstEdge = 0; firstEdge < edgeCount; firstEdge += 1) {
    for (let secondEdge = firstEdge + 1; secondEdge < edgeCount; secondEdge += 1) {
      if (secondEdge === firstEdge + 1 || (firstEdge === 0 && secondEdge === edgeCount - 1)) continue;
      if (segmentsIntersect(ring[firstEdge], ring[firstEdge + 1], ring[secondEdge], ring[secondEdge + 1])) return false;
    }
  }
  return true;
}

function validRing(input: number[][]): GeoJSON.Position[] | null {
  if (!Array.isArray(input) || input.length < 4) return null;
  const ring: GeoJSON.Position[] = [];
  for (const point of input) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const [longitude, latitude] = point;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
      || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    ring.push([longitude, latitude]);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) > 1e-8 || Math.abs(first[1] - last[1]) > 1e-8) return null;
  const uniqueVertices = new Set(ring.slice(0, -1).map(point => `${point[0]},${point[1]}`));
  if (uniqueVertices.size < 3 || !isSimpleRing(ring)) return null;
  let signedArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index], next = ring[index + 1];
    signedArea += current[0] * next[1] - next[0] * current[1];
  }
  // Normalise exterior rings to GeoJSON's counter-clockwise winding order.
  return signedArea < 0 ? [...ring].reverse() : ring;
}

/**
 * Build map geometry only from verified, current CAP records and their supplied polygons.
 * No county centroids, place-name geocoding or inferred footprints are allowed here.
 */
export function buildOfficialWarningAreaCollection(
  feed: OfficialWeatherWarningFeed | undefined,
): OfficialWarningAreaCollection {
  if (!feed || (feed.status !== 'AVAILABLE' && feed.status !== 'STALE_FALLBACK')) return EMPTY_COLLECTION;

  const features: OfficialWarningAreaCollection['features'] = [];
  for (const alert of feed.alerts ?? []) {
    if (!alert.verifiedCap || (alert.activeState !== 'ACTIVE' && alert.activeState !== 'UPCOMING')) continue;
    for (const area of alert.areas ?? []) {
      for (const polygon of area.polygons ?? []) {
        if (features.length >= MAX_WARNING_POLYGONS) return { type: 'FeatureCollection', features };
        const ring = validRing(polygon);
        if (!ring) continue;
        features.push({
          type: 'Feature',
          id: `${alert.id}:${features.length}`,
          properties: {
            alertId: String(alert.id),
            title: String(alert.title || 'Official weather warning'),
            area: String(area.description || 'Mapped warning area'),
            severity: String(alert.severity || 'unknown').toLowerCase(),
            activeState: alert.activeState,
            feedStatus: feed.status,
          },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Recreate warning layers whenever MapLibre swaps base styles; preserve text labels above the overlay. */
export function syncOfficialWarningLayers(
  map: MapLibreMap,
  data: OfficialWarningAreaCollection,
  visible: boolean,
): void {
  if (!map.isStyleLoaded()) return;
  const visibility = visible && data.features.length > 0 ? 'visible' : 'none';
  const existing = map.getSource(OFFICIAL_WARNING_SOURCE_ID) as GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else map.addSource(OFFICIAL_WARNING_SOURCE_ID, { type: 'geojson', data });

  const beforeSymbol = map.getStyle().layers?.find(layer => layer.type === 'symbol')?.id;
  if (!map.getLayer(OFFICIAL_WARNING_FILL_LAYER_ID)) {
    map.addLayer({
      id: OFFICIAL_WARNING_FILL_LAYER_ID,
      type: 'fill',
      source: OFFICIAL_WARNING_SOURCE_ID,
      layout: { visibility },
      paint: {
        'fill-color': [
          'match', ['get', 'severity'],
          'extreme', '#ed5e65',
          'severe', '#ef7957',
          'moderate', '#e6ae5e',
          'minor', '#d9c875',
          '#d49a68',
        ],
        'fill-opacity': [
          'case',
          ['==', ['get', 'feedStatus'], 'STALE_FALLBACK'], 0.06,
          ['==', ['get', 'activeState'], 'UPCOMING'], 0.075,
          0.17,
        ],
      },
    }, beforeSymbol);
  } else {
    map.setLayoutProperty(OFFICIAL_WARNING_FILL_LAYER_ID, 'visibility', visibility);
  }

  if (!map.getLayer(OFFICIAL_WARNING_LINE_LAYER_ID)) {
    map.addLayer({
      id: OFFICIAL_WARNING_LINE_LAYER_ID,
      type: 'line',
      source: OFFICIAL_WARNING_SOURCE_ID,
      layout: { visibility, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'severity'],
          'extreme', '#ff7a80',
          'severe', '#ff9877',
          'moderate', '#f2c170',
          'minor', '#e5d993',
          '#e1b187',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.15, 5, 2.2, 10, 3],
        'line-opacity': ['case', ['==', ['get', 'feedStatus'], 'STALE_FALLBACK'], 0.5, 0.94],
      },
    }, beforeSymbol);
  } else {
    map.setLayoutProperty(OFFICIAL_WARNING_LINE_LAYER_ID, 'visibility', visibility);
  }
}
