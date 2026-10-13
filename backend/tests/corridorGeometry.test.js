'use strict';

const {
  buildCorridorGeometry,
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

  test('retains useful source detail well above the former 800-point cap', () => {
    const path = [];
    for (let i = 0; i <= 1600; i++) {
      path.push([0.00018 * Math.sin((Math.PI * 80 * i) / 1600), i / 1600]);
    }
    const result = simplifyPath(path, 10);
    expect(result.originalPointCount).toBe(1601);
    expect(result.path).toHaveLength(1601);
    expect(result.toleranceM).toBe(0);
    expect(result.path[0]).toEqual(path[0]);
    expect(result.path[result.path.length - 1]).toEqual(path[path.length - 1]);
  });

  test('rejects a requested tolerance wider than the operation-specific ceiling', () => {
    expect(() => simplifyPath([[0, 0], [0, 0.01]], 10, 5)).toThrow(/configured 5 m ceiling/i);
  });

  test('simplifies oversized straight routes within the requested metre tolerance', () => {
    const path = [];
    // 12,001 closely spaced samples over a long route: the route input budget
    // can carry this data, while a near-straight centreline should simplify to
    // its endpoints rather than fail because of the old 800-point output cap.
    for (let i = 0; i <= 12000; i++) path.push([0, i / 100000]);
    const result = simplifyPath(path, 10);

    expect(result.originalPointCount).toBe(12001);
    expect(result.path).toEqual([path[0], path[path.length - 1]]);
    expect(result.toleranceM).toBe(10);
    expect(result.toleranceEscalated).toBe(false);
    expect(result.method).toBe('douglas-peucker');
    const polygon = buildCorridorPolygon(result.path, 300);
    expect(polygon).toHaveLength(5);
    expect(validateCorridorGeometry(result.path, polygon, 300)).toMatchObject({ valid: true });
  });

  test('validates a corridor with thousands of centreline points without quadratic all-pairs work', () => {
    const path = [];
    for (let i = 0; i <= 5000; i++) path.push([0, i * 0.00009]);
    const polygon = buildCorridorPolygon(path, 300);

    expect(path.length).toBeGreaterThan(800);
    expect(polygon).toHaveLength(10003);
    expect(validateCorridorGeometry(path, polygon, 300)).toMatchObject({
      valid: true,
      pathPoints: 5001,
      polygonPoints: 10003,
    });
  });

  test('recovers a self-intersecting tight loop only within the corridor-relative tolerance ceiling', () => {
    const path = [[0, 0], [0, 0.0004], [0.00005, 0.0004], [0.00005, 0]];
    const bufferM = 300;

    expect(() => buildCorridorPolygon(path, bufferM)).toThrow(/self-intersects/i);
    const recovered = buildCorridorGeometry(path, bufferM, 10, 100);

    expect(recovered.recoveryUsed).toBe(true);
    expect(recovered.bufferPolygonMethod).toBe('validated-miter-offset-recovered');
    expect(recovered.simplification.toleranceM).toBeLessThanOrEqual(bufferM / 3);
    expect(recovered.path[0]).toEqual(path[0]);
    expect(recovered.path[recovered.path.length - 1]).toEqual(path[path.length - 1]);
    expect(validateCorridorGeometry(recovered.path, recovered.polygon, bufferM)).toMatchObject({ valid: true });
    let maximumDeviationM = 0;
    for (const point of path) {
      let nearest = Infinity;
      for (let i = 0; i < recovered.path.length - 1; i++) {
        nearest = Math.min(nearest, pointToSegmentDistanceM(point, recovered.path[i], recovered.path[i + 1]));
      }
      maximumDeviationM = Math.max(maximumDeviationM, nearest);
    }
    expect(maximumDeviationM).toBeLessThanOrEqual(recovered.simplification.toleranceM + 0.5);
  });

  test('validates robust external-buffer rings without requiring one vertex per centreline point', () => {
    const path = [[0, 0], [0, 0.01], [0.01, 0.01]];
    const exteriorRing = [
      [-0.003, -0.003],
      [-0.003, 0.013],
      [0.013, 0.013],
      [0.013, -0.003],
      [-0.003, -0.003],
    ];

    expect(exteriorRing).toHaveLength(5);
    expect(validateCorridorGeometry(path, exteriorRing, 300, { method: 'postgis-geography-buffer' }))
      .toMatchObject({ valid: true, containsCenterline: true, pathPoints: 3, polygonPoints: 5 });
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
