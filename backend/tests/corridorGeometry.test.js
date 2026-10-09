'use strict';

const {
  buildCorridorPolygon,
  distanceM,
  midpointOnPath,
  simplifyPath,
  validateCorridorGeometry,
} = require('../src/utils/corridorGeometry');

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

  test('bounds dense route vertices while preserving the endpoints', () => {
    const path = [];
    for (let i = 0; i <= 1600; i++) path.push([0, i / 1600]);
    const result = simplifyPath(path, 10);
    expect(result.originalPointCount).toBe(1601);
    expect(result.path.length).toBeLessThanOrEqual(800);
    expect(result.toleranceM).toBe(10);
    expect(result.path[0]).toEqual(path[0]);
    expect(result.path[result.path.length - 1]).toEqual(path[path.length - 1]);
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
