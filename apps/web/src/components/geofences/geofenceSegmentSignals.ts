import type { SpatialWorldEntity } from '../../lib/spatialClient.js';

export type CorridorSignalKind = 'traffic' | 'weather' | 'security' | 'hazard';

export interface CorridorSignalRoute {
  id: string;
  name: string;
  path?: [number, number][] | null;
  buffer_m?: number | null;
}

interface SignalClass {
  id: string;
  latitude: number;
  longitude: number;
  kind: CorridorSignalKind;
  color: string;
  severity: number;
  stale: boolean;
  label: string;
  radiusM: number;
}

interface SignalProperties {
  route_id: string;
  route_name: string;
  signal_kind: CorridorSignalKind;
  signal_color: string;
  signal_severity: number;
  signal_stale: boolean;
  signal_label: string;
  signal_count: number;
  distance_m: number;
}

export interface CorridorSignalOverlay {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, SignalProperties>;
  markers: GeoJSON.FeatureCollection<GeoJSON.Point, SignalProperties>;
  summary: {
    totalSegments: number;
    affectedSegments: number;
    trafficSegments: number;
    weatherSegments: number;
    securitySegments: number;
    hazardSegments: number;
    staleSegments: number;
    dataPoints: number;
  };
}

interface SegmentSignal {
  id: string;
  kind: CorridorSignalKind;
  color: string;
  severity: number;
  stale: boolean;
  label: string;
  distanceM: number;
}

const DEFAULT_RADIUS_M: Record<CorridorSignalKind, number> = {
  traffic: 1800,
  weather: 15000,
  security: 12000,
  hazard: 15000,
};

const PALETTE = {
  trafficLow: '#facc15',
  trafficMedium: '#fb923c',
  trafficHigh: '#ef4444',
  weather: '#a78bfa',
  weatherAdverse: '#f59e0b',
  weatherSevere: '#fb7185',
  security: '#f97316',
  critical: '#ff334f',
  stale: '#94a3b8',
} as const;

function finiteCoordinate(point: unknown): point is [number, number] {
  if (!Array.isArray(point) || point.length < 2) return false;
  const lat = Number(point[0]);
  const lng = Number(point[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
}

function wrappedLongitudeDelta(delta: number): number {
  return ((delta + 540) % 360) - 180;
}

// Used only for proximity matching of nearby observations. It does not alter
// the saved operational centreline or claim to represent an exact hazard edge.
function distanceToSegmentM(point: [number, number], start: [number, number], end: [number, number]): number {
  const meanLat = ((start[0] + end[0] + point[0]) / 3) * Math.PI / 180;
  const cosLat = Math.max(0.087, Math.abs(Math.cos(meanLat)));
  const xScale = 111320 * cosLat;
  const yScale = 110574;
  const bx = wrappedLongitudeDelta(end[1] - start[1]) * xScale;
  const by = (end[0] - start[0]) * yScale;
  const px = wrappedLongitudeDelta(point[1] - start[1]) * xScale;
  const py = (point[0] - start[0]) * yScale;
  const lengthSq = bx * bx + by * by;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

function numericAttribute(attributes: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = attributes[key];
    if (value == null || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function classifyEntity(entity: SpatialWorldEntity, nowMs: number): SignalClass | null {
  if (!finiteCoordinate([entity.latitude, entity.longitude])) return null;
  const type = String(entity.entityType || '').toLowerCase();
  const attrs = entity.attributes ?? {};
  const text = [
    entity.status,
    attrs.title,
    attrs.name,
    attrs.description,
    attrs.category,
    attrs.categoryTitle,
    attrs.condition,
    attrs.weather,
    attrs.event,
    attrs.severity,
    attrs.impact,
  ].filter(value => value != null).join(' ').toLowerCase();

  let kind: CorridorSignalKind;
  let severity = 1;
  let color = PALETTE.weather;
  if (type.startsWith('traffic_') || type === 'traffic' || type.includes('road_closure')) {
    kind = 'traffic';
    const magnitude = Number(attrs.magnitudeOfDelay ?? attrs.magnitude_of_delay ?? 0);
    const delay = Number(attrs.delaySeconds ?? attrs.delay_seconds ?? 0);
    const closed = attrs.closed === true || attrs.closure === true || /road closure|closed road|road closed/.test(text);
    severity = closed || magnitude >= 4 ? 4 : /critical|major|severe/.test(text) || magnitude >= 3 ? 3 : /moderate/.test(text) || magnitude >= 2 || delay >= 300 ? 2 : 1;
    color = severity >= 3 ? PALETTE.trafficHigh : severity === 2 ? PALETTE.trafficMedium : PALETTE.trafficLow;
  } else if (type === 'weather' || type.startsWith('weather_')) {
    kind = 'weather';
    severity = /extreme|severe|cyclone|hurricane|flood|flash flood|tornado|violent storm|thunderstorm/.test(text)
      ? 4
      : /heavy rain|strong wind|high wind|fog|low visibility|heatwave|heat wave|hail|snow|storm|thunder|rain/.test(text)
        ? 2
        : /warning|alert|advisory/.test(text) ? 3 : 1;
    color = severity >= 4 ? PALETTE.weatherSevere : severity >= 2 ? PALETTE.weatherAdverse : PALETTE.weather;
  } else if (['risk_zone', 'security', 'intelligence_alert'].includes(type) || /security|armed attack|ambush|bandit|conflict|kidnap|robbery|threat/.test(type + ' ' + text)) {
    kind = 'security';
    severity = /critical|extreme|very high/.test(text) ? 4 : /high|severe|active threat|ambush|attack|kidnap/.test(text) ? 3 : /medium|moderate/.test(text) ? 2 : 1;
    color = severity >= 4 ? PALETTE.critical : severity >= 3 ? '#ef4444' : PALETTE.security;
  } else if (['natural_hazard', 'hazard', 'incident', 'alert'].includes(type) || type.includes('hazard')) {
    kind = 'hazard';
    severity = /critical|extreme|severe|major/.test(text) ? 4 : /high|warning|danger/.test(text) ? 3 : /medium|moderate/.test(text) ? 2 : 1;
    color = severity >= 3 ? PALETTE.critical : '#fb7185';
  } else {
    return null;
  }

  const freshness = String(entity.quality?.freshnessClass ?? entity.quality?.state ?? '').toUpperCase();
  const timestamp = entity.observedAt || entity.receivedAt;
  const ageMs = timestamp ? nowMs - Date.parse(timestamp) : Infinity;
  const stale = ['STALE', 'UNKNOWN', 'EXPIRED', 'UNAVAILABLE'].includes(freshness)
    || (Number.isFinite(ageMs) && ageMs > 2 * 60 * 60 * 1000)
    || !Number.isFinite(ageMs);
  if (stale) color = PALETTE.stale;

  const radius = numericAttribute(attrs, ['impactRadiusM', 'impact_radius_m', 'radiusM', 'radius_m']);
  const radiusKm = numericAttribute(attrs, ['radiusKm', 'radius_km']);
  const radiusM = Math.min(50000, radius ?? (radiusKm == null ? DEFAULT_RADIUS_M[kind] : radiusKm * 1000));
  const rawLabel = attrs.title ?? attrs.description ?? attrs.categoryTitle ?? attrs.category ?? attrs.condition ?? entity.status ?? entity.entityType;
  const label = String(rawLabel || entity.entityType).replace(/\s+/g, ' ').trim().slice(0, 100);

  return {
    id: String(entity.id),
    latitude: Number(entity.latitude),
    longitude: Number(entity.longitude),
    kind, color, severity, stale, label, radiusM,
  };
}

function stronger(a: SegmentSignal, b: SegmentSignal): boolean {
  if (a.stale !== b.stale) return !a.stale;
  if (a.severity !== b.severity) return a.severity > b.severity;
  if (a.distanceM !== b.distanceM) return a.distanceM < b.distanceM;
  const priority: Record<CorridorSignalKind, number> = { security: 4, hazard: 3, traffic: 2, weather: 1 };
  return priority[a.kind] > priority[b.kind];
}

export function buildCorridorSignalOverlay(
  routes: CorridorSignalRoute[],
  entities: SpatialWorldEntity[],
  nowMs = Date.now(),
): CorridorSignalOverlay {
  const candidates = entities
    .map(entity => classifyEntity(entity, nowMs))
    .filter((item): item is SignalClass => item !== null);

  const features: GeoJSON.Feature<GeoJSON.LineString, SignalProperties>[] = [];
  const markers: GeoJSON.Feature<GeoJSON.Point, SignalProperties>[] = [];
  const summary: CorridorSignalOverlay['summary'] = {
    totalSegments: 0,
    affectedSegments: 0,
    trafficSegments: 0,
    weatherSegments: 0,
    securitySegments: 0,
    hazardSegments: 0,
    staleSegments: 0,
    dataPoints: candidates.length,
  };

  for (const route of routes) {
    const path = (route.path ?? []).filter(finiteCoordinate);
    if (path.length < 2) continue;
    const bufferM = Math.max(0, Math.min(5000, Number(route.buffer_m) || 0));
    let current: {
      kind: CorridorSignalKind;
      color: string;
      severity: number;
      stale: boolean;
      coords: [number, number][];
      entityIds: Set<string>;
      labels: Set<string>;
      distanceM: number;
    } | null = null;

    const flush = () => {
      if (!current || current.coords.length < 2) { current = null; return; }
      const properties: SignalProperties = {
        route_id: route.id,
        route_name: route.name,
        signal_kind: current.kind,
        signal_color: current.color,
        signal_severity: current.severity,
        signal_stale: current.stale,
        signal_label: Array.from(current.labels).slice(0, 3).join(' · ') || current.kind,
        signal_count: current.entityIds.size,
        distance_m: Math.round(current.distanceM),
      };
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: current.coords },
        properties,
      });
      const markerCoordinate = current.coords[Math.floor((current.coords.length - 1) / 2)]!;
      markers.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [markerCoordinate[0], markerCoordinate[1]] },
        properties,
      });
      current = null;
    };

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      summary.totalSegments++;
      let best: SegmentSignal | null = null;

      for (const candidate of candidates) {
        const distanceM = distanceToSegmentM([candidate.latitude, candidate.longitude], a, b);
        if (distanceM > candidate.radiusM + bufferM) continue;
        const next: SegmentSignal = {
          id: candidate.id,
          kind: candidate.kind,
          color: candidate.color,
          severity: candidate.severity,
          stale: candidate.stale,
          label: candidate.label,
          distanceM,
        };
        if (!best || stronger(next, best)) best = next;
      }

      if (!best) {
        flush();
        continue;
      }

      summary.affectedSegments++;
      if (best.kind === 'traffic') summary.trafficSegments++;
      else if (best.kind === 'weather') summary.weatherSegments++;
      else if (best.kind === 'security') summary.securitySegments++;
      else summary.hazardSegments++;
      if (best.stale) summary.staleSegments++;

      const matchesCurrent = current
        && current.kind === best.kind
        && current.color === best.color
        && current.severity === best.severity
        && current.stale === best.stale;
      if (!matchesCurrent) flush();
      if (!current) {
        current = {
          kind: best.kind,
          color: best.color,
          severity: best.severity,
          stale: best.stale,
          coords: [[a[1], a[0]], [b[1], b[0]]],
          entityIds: new Set([best.id]),
          labels: new Set([best.label]),
          distanceM: best.distanceM,
        };
      } else {
        const last = current.coords[current.coords.length - 1]!;
        const nextCoordinate: [number, number] = [b[1], b[0]];
        if (Math.abs(last[0] - nextCoordinate[0]) > 1e-7 || Math.abs(last[1] - nextCoordinate[1]) > 1e-7) current.coords.push(nextCoordinate);
        current.entityIds.add(best.id);
        current.labels.add(best.label);
        current.distanceM = Math.min(current.distanceM, best.distanceM);
      }
    }
    flush();
  }

  return {
    segments: { type: 'FeatureCollection', features },
    markers: { type: 'FeatureCollection', features: markers.slice(0, 100) },
    summary,
  };
}
