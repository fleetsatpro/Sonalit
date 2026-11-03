import { describe, expect, test } from 'vitest';
import { toCoordinatePair } from './coordinatePair.js';

describe('toCoordinatePair', () => {
  test('returns MapLibre longitude-latitude order for valid numeric inputs', () => {
    expect(toCoordinatePair(-1.2864, 36.8172)).toEqual([36.8172, -1.2864]);
    expect(toCoordinatePair('-4.0435', '39.6682')).toEqual([39.6682, -4.0435]);
  });

  test('rejects blank and missing coordinates instead of coercing them to zero', () => {
    expect(toCoordinatePair('', '36.8172')).toBeNull();
    expect(toCoordinatePair('   ', '36.8172')).toBeNull();
    expect(toCoordinatePair('-1.2864', '')).toBeNull();
    expect(toCoordinatePair(null, '36.8172')).toBeNull();
    expect(toCoordinatePair(undefined, 36.8172)).toBeNull();
  });

  test('rejects invalid ranges, non-numeric values and the null-island sentinel', () => {
    expect(toCoordinatePair(91, 36)).toBeNull();
    expect(toCoordinatePair(-1, 181)).toBeNull();
    expect(toCoordinatePair('nairobi', '36.8')).toBeNull();
    expect(toCoordinatePair(Number.NaN, 36)).toBeNull();
    expect(toCoordinatePair(0, 0)).toBeNull();
  });

  test('preserves valid equator and prime-meridian coordinates', () => {
    expect(toCoordinatePair(0, 36)).toEqual([36, 0]);
    expect(toCoordinatePair(10, 0)).toEqual([0, 10]);
  });
});
