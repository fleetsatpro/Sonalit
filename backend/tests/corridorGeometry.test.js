'use strict';
const { buildCorridorPolygon, distanceM, validateCorridorGeometry } = require('../src/utils/corridorGeometry');

describe('corridor geometry', () => {
  test('two-point route uses the requested metre buffer', () => {
    const path = [[0, 0], [0, 1]];
    const polygon = buildCorridorPolygon(path, 300);
    expect(polygon).toHaveLength(5);
    expect(distanceM(path[0], polygon[0])).toBeCloseTo(300, 0);
    expect(distanceM(path[0], polygon[3])).toBeCloseTo(300, 0);
    expect(validateCorridorGeometry(path, polygon, 300).valid).toBe(true);
  });

  test('right-angle route produces a valid closed polygon', () => {
    const path = [[0, 0], [0, 0.01], [0.01, 0.01]];
    const polygon = buildCorridorPolygon(path, 120);
    expect(polygon).toHaveLength(7);
    expect(polygon[0]).toEqual(polygon[polygon.length - 1]);
    expect(validateCorridorGeometry(path, polygon, 120).valid).toBe(true);
  });

  test('rejects malformed route coordinates rather than silently dropping them', () => {
    expect(() => buildCorridorPolygon([[0, 0], [NaN, 3]], 300)).toThrow();
  });
});
