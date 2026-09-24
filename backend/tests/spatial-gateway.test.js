'use strict';

const { validateBbox } = require('../src/services/spatial/openskyGateway');

describe('spatial OpenSky bbox validation', () => {
  test('accepts a valid bounded bbox', () => {
    expect(validateBbox([-1, -1, 1, 1])).toEqual([-1, -1, 1, 1]);
  });

  test('rejects malformed values and reversed bounds', () => {
    expect(validateBbox([-1, -1, 1])).toBeNull();
    expect(validateBbox(['x', -1, 1, 1])).toBeNull();
    expect(validateBbox([1, -1, -1, 1])).toBeNull();
    expect(validateBbox([-1, 1, 1, -1])).toBeNull();
  });

  test('rejects coordinates outside WGS84 and oversized areas', () => {
    expect(validateBbox([-181, -1, 1, 1])).toBeNull();
    expect(validateBbox([-1, -91, 1, 1])).toBeNull();
    expect(validateBbox([-10, -10, 10, 10])).toBeNull();
  });
});
