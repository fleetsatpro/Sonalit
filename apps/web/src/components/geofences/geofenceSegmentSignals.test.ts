import { describe, expect, it } from 'vitest';
import type { SpatialWorldEntity } from '../../lib/spatialClient.js';
import { buildCorridorSignalOverlay } from './geofenceSegmentSignals.js';

const now = Date.parse('2026-10-13T12:00:00.000Z');

function observation(input: Partial<SpatialWorldEntity> & Pick<SpatialWorldEntity, 'id' | 'entityType' | 'latitude' | 'longitude'>): SpatialWorldEntity {
  return {
    ...input,
    id: input.id,
    entityType: input.entityType,
    latitude: input.latitude,
    longitude: input.longitude,
    source: input.source ?? 'regression-test',
    observedAt: input.observedAt ?? new Date(now - 60_000).toISOString(),
    quality: input.quality ?? { freshnessClass: 'LIVE' },
    attributes: input.attributes ?? {},
  };
}

function routePath(): [number, number][] {
  return Array.from({ length: 51 }, (_, index) => [0, index * 0.005] as [number, number]);
}

describe('evidence-backed corridor signal segments', () => {
  it('colors only route portions near current traffic and weather observations', () => {
    const traffic = observation({
      id: 'traffic-closure',
      entityType: 'traffic_incident',
      latitude: 0,
      longitude: 0.02,
      attributes: { magnitudeOfDelay: 4, closed: true, description: 'Road closure' },
    });
    const weather = observation({
      id: 'heavy-rain',
      entityType: 'weather',
      latitude: 0,
      longitude: 0.22,
      attributes: { condition: 'heavy rain' },
    });

    const overlay = buildCorridorSignalOverlay([
      { id: 'route-1', name: 'Kisumu to Tunduma', type: 'corridor', path: routePath(), buffer_m: 300 },
    ], [traffic, weather], now);

    expect(overlay.summary.totalSegments).toBe(50);
    expect(overlay.summary.affectedSegments).toBeGreaterThan(0);
    expect(overlay.summary.affectedSegments).toBeLessThan(overlay.summary.totalSegments);
    expect(overlay.summary.trafficSegments).toBeGreaterThan(0);
    expect(overlay.summary.weatherSegments).toBeGreaterThan(0);
    expect(overlay.segments.features.some(feature => feature.properties?.signal_kind === 'traffic'
      && feature.properties.signal_color === '#ef4444')).toBe(true);
    expect(overlay.segments.features.some(feature => feature.properties?.signal_kind === 'weather'
      && feature.properties.signal_color === '#f59e0b')).toBe(true);
    expect(overlay.segments.features.every(feature => feature.properties?.route_id === 'route-1')).toBe(true);
    expect(overlay.markers.features.length).toBeGreaterThan(0);
  });

  it('keeps a route neutral when no matching evidence is available', () => {
    const overlay = buildCorridorSignalOverlay([
      { id: 'route-2', name: 'Neutral route', path: routePath(), buffer_m: 300 },
    ], [], now);

    expect(overlay.summary.totalSegments).toBe(50);
    expect(overlay.summary.affectedSegments).toBe(0);
    expect(overlay.segments.features).toHaveLength(0);
    expect(overlay.markers.features).toHaveLength(0);
  });

  it('shows stale security evidence in muted grey rather than as a live red threat', () => {
    const staleSecurity = observation({
      id: 'old-risk-zone',
      entityType: 'risk_zone',
      latitude: 0,
      longitude: 0.02,
      observedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
      quality: { freshnessClass: 'STALE' },
      attributes: { severity: 'high', name: 'Historical risk area' },
    });
    const overlay = buildCorridorSignalOverlay([
      { id: 'route-3', name: 'Route with stale observation', path: routePath().slice(0, 11), buffer_m: 300 },
    ], [staleSecurity], now);

    expect(overlay.segments.features.length).toBeGreaterThan(0);
    expect(overlay.segments.features.every(feature => feature.properties?.signal_stale === true)).toBe(true);
    expect(overlay.segments.features.every(feature => feature.properties?.signal_color === '#94a3b8')).toBe(true);
    expect(overlay.summary.staleSegments).toBeGreaterThan(0);
  });

  it('fails closed for malformed route geometry instead of joining across invalid points', () => {
    const overlay = buildCorridorSignalOverlay([
      { id: 'broken-route', name: 'Broken route', path: [[0, 0], [0, 0.01], [91, 0.02], [0, 0.03]], buffer_m: 300 },
    ], [observation({
      id: 'nearby-traffic',
      entityType: 'traffic_incident',
      latitude: 0,
      longitude: 0.02,
      attributes: { magnitudeOfDelay: 4 },
    })], now);

    expect(overlay.summary.totalSegments).toBe(0);
    expect(overlay.segments.features).toHaveLength(0);
  });
});
