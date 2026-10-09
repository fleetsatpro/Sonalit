'use strict';

const {
  buildCorridorPolygon,
  distanceM,
  midpointOnPath,
  simplifyPath,
  validateCorridorGeometry,
} = require('../src/utils/corridorGeometry');

const EARTH_RADIUS_M = 6371008.8;
function pointToSegmentDistanceM(point, start, end) {
  const scale = EARTH_RADIUS_M * Math.PI / 180;
  const latScale = Math.cos(((start[0] + end[0]) / 2) * Math.PI / 180);
  const wrappedDelta = delta => ((delta + 540) % 360) - 180;
  const dx = wrappedDelta(end[1] - start[1]) * scale * latScale;
  const dy = (end[0] - start[0]) * scale;
  const px = wrappedDelta(point[1] - start[1]) * scale * latScale;
  const py = (point[0] - start[0]) * scale;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

describe('validated corridor geometry', () => {
  test('straight two-point routes preserve the requested metre half-width', () => {
    const path = [[0, 0], [0, 1]];
    const polygon = buildCorridorPolygon(path, 300);

    expect(polygon).toHaveLength(5);
    expect(distanceM(path[0], polygon[0])).toBeCloseTo(300, 0);
    expect(distanceM(path[1], polygon[1])).toBeCloseTo(300, 0);
    expect(validateCorridorGeometry(path, polygon, 300)).toMatchObject({ valid: true, pathPoints: 2 });
  });

  test('bent routes produce finite, closed, bounded, non-self-intersecting envelopes', () => {
    const path = [[0, 0], [0, 0.01], [0.01, 0.01]];
    const bufferM = 120;
    const polygon = buildCorridorPolygon(path, bufferM);
    const checked = validateCorridorGeometry(path, polygon, bufferM);

    expect(polygon).toHaveLength(7);
    expect(polygon[0]).toEqual(polygon[polygon.length - 1]);
    expect(polygon.every(point => point.every(Number.isFinite))).toBe(true);
    expect(checked.valid).toBe(true);
    expect(checked.minOffsetM).toBeGreaterThanOrEqual(bufferM * 0.9);
    expect(checked.maxOffsetM).toBeLessThanOrEqual(bufferM * 2.5 + 2);
  });

  test('finds the distance midpoint when routed vertices are highly non-uniform', () => {
    const path = [[0, 0], [0, 0.01], [0, 1]];
    const midpoint = midpointOnPath(path);
    const totalLengthM = distanceM(path[0], path[1]) + distanceM(path[1], path[2]);

    expect(midpoint[0]).toBeCloseTo(0, 6);
    expect(midpoint[1]).toBeCloseTo(0.5, 2);
    expect(distanceM(path[0], midpoint)).toBeCloseTo(totalLengthM / 2, 0);
  });

  test('bounds dense route vertices without exceeding the declared metre tolerance', () => {
    const path = [];
    for (let i = 0; i <= 1600; i++) {
      path.push([0.00018 * Math.sin((Math.PI * 80 * i) / 1600), i / 1600]);
    }
    const result = simplifyPath(path, 10);
    expect(result.originalPointCount).toBe(1601);
    expect(result.path.length).toBeLessThanOrEqual(800);
    expect(result.path.length).toBeGreaterThan(2);
    expect(result.toleranceM).toBe(10);
    expect(result.path[0]).toEqual(path[0]);
    expect(result.path[result.path.length - 1]).toEqual(path[path.length - 1]);

    const sourceIndexes = new Map(path.map((point, index) => [point.join(','), index]));
    const retained = result.path.map(point => sourceIndexes.get(point.join(',')));
    let maximumErrorM = 0;
    for (let segment = 0; segment < retained.length - 1; segment++) {
      const first = retained[segment];
      const last = retained[segment + 1];
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      for (let i = first; i <= last; i++) {
        maximumErrorM = Math.max(maximumErrorM, pointToSegmentDistanceM(path[i], path[first], path[last]));
      }
    }
    expect(maximumErrorM).toBeLessThanOrEqual(10.5);
  });

  test('handles the distance midpoint across the antimeridian', () => {
    const path = [[0, 179.9], [0, -179.9]];
    const midpoint = midpointOnPath(path);
    const polygon = buildCorridorPolygon(path, 300);

    expect(Math.abs(Math.abs(midpoint[1]) - 180)).toBeLessThan(0.01);
    expect(validateCorridorGeometry(path, polygon, 300).valid).toBe(true);
  });

  test('rejects malformed, degenerate and excessively wide geometry instead of guessing', () => {
    expect(() => buildCorridorPolygon([[0, 0], [NaN, 3]], 300)).toThrow(/invalid coordinate/i);
    expect(() => buildCorridorPolygon([[0, 0], [0, 1]], 5)).toThrow(/10 and 5000 metres/i);
    expect(() => buildCorridorPolygon([[0, 0], [0, 1]], 6000)).toThrow(/10 and 5000 metres/i);
    expect(() => buildCorridorPolygon([[0, 0], [0, 1], [0, 0.1]], 300)).toThrow(/reverses direction/i);
  });
});
