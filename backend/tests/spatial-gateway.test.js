'use strict';

const { validateBbox, normalizeState } = require('../src/services/spatial/openskyGateway');

const RECEIVED = '2026-09-24T00:00:00.000Z';

describe('spatial OpenSky bbox validation', () => {
  test('accepts a valid bounded bbox', () => {
    expect(validateBbox([-1, -1, 1, 1])).toEqual([-1, -1, 1, 1]);
    test('keeps missing source timestamps unknown', () => {
    const row = [
      'abc123', ' TEST123 ', 'Testland', null, null,
      36.8, -1.3, 1000, false, 200, 180,
      0, null, 1000, null,
    ];
    const obs = normalizeState(row, RECEIVED);
    expect(obs).not.toBeNull();
    expect(obs.observedAt).toBeNull();
    expect(obs.quality.freshnessClass).toBe('UNKNOWN');
    expect(obs.freshnessMs).toBeUndefined();
  });
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
