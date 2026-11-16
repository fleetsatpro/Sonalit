import { describe, expect, it } from 'vitest';
import { minimalLongitudeBounds } from './geographicBounds.js';

describe('minimal longitude bounds', () => {
  it('keeps devices on opposite sides of the date line in one narrow viewport', () => {
    expect(minimalLongitudeBounds([179, -179])).toEqual([179, 181]);
    expect(minimalLongitudeBounds([-179, 179])).toEqual([179, 181]);
  });

  it('finds the smallest interval for a wider group crossing the date line', () => {
    expect(minimalLongitudeBounds([170, 175, -170, -175])).toEqual([170, 190]);
  });

  it('keeps ordinary regional longitudes in their expected signed range', () => {
    expect(minimalLongitudeBounds([-74, -73, -73.5])).toEqual([-74, -73]);
    expect(minimalLongitudeBounds([36.8, 37.1])).toEqual([36.8, 37.1]);
  });

  it('handles duplicate, single and unusable coordinates safely', () => {
    expect(minimalLongitudeBounds([12, 12])).toEqual([12, 12]);
    expect(minimalLongitudeBounds([-170])).toEqual([-170, -170]);
    expect(minimalLongitudeBounds([Number.NaN, Number.POSITIVE_INFINITY])).toEqual([-180, 180]);
  });
});
