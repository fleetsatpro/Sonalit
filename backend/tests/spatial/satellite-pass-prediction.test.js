'use strict';

const {
  parseTleCatalog,
  normaliseRecord
} = require('../../src/services/spatial/celestrakGateway');
const {
  predictPassesForRecords,
  MAX_WINDOW_HOURS,
  MAX_PASSES,
  MAX_OBJECTS
} = require('../../src/services/spatial/satellitePassPredictor');

const ISS_TLE_1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const ISS_TLE_2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';

describe('satellite pass prediction', () => {
  test('predicts bounded geometric ISS passes without tasking semantics', () => {
    const records = parseTleCatalog(['ISS (ZARYA)', ISS_TLE_1, ISS_TLE_2].join('\n'))
      .map(row => normaliseRecord(row, 'stations'));

    const result = predictPassesForRecords(records, {
      lat: 0,
      lng: 0,
      from: '2019-06-05T00:00:00Z',
      windowHours: 72,
      horizonDeg: 10,
      maxPasses: 20
    });

    expect(result.scannedObjects).toBe(1);
    expect(result.passes.length).toBeGreaterThanOrEqual(5);
    expect(result.passes.length).toBeLessThanOrEqual(MAX_PASSES);
    expect(new Set(result.passes.map(p => p.aosAt || p.maxElevationAt)).size).toBe(result.passes.length);
    expect(result.passes).toEqual(
      [...result.passes].sort((a, b) => Date.parse(a.aosAt || a.maxElevationAt) - Date.parse(b.aosAt || b.maxElevationAt))
    );
    expect(Math.max(...result.passes.map(p => p.maxElevationDeg))).toBeGreaterThan(70);
    expect(Math.max(...result.passes.map(p => p.maxElevationDeg))).toBeLessThan(90);

    for (const pass of result.passes) {
      expect(pass.positionSource).toBe('sgp4_modelled');
      expect(pass.telemetryLive).toBe(false);
      expect(pass.imagingClaim).toBe(false);
      expect(pass.taskingClaim).toBe(false);
      expect(pass.uncertainty.join(' ')).toMatch(/Geometric AOS\/LOS only|geometric results/i);
    }
  });

  test('hard bounds reject oversized prediction requests', () => {
    expect(() => predictPassesForRecords([], {
      lat: 0,
      lng: 0,
      windowHours: MAX_WINDOW_HOURS + 1
    })).toThrow(/windowHours/);

    expect(() => predictPassesForRecords([], {
      lat: 0,
      lng: 0,
      maxPasses: MAX_PASSES + 1
    })).toThrow(/maxPasses/);

    expect(() => predictPassesForRecords(new Array(MAX_OBJECTS + 1).fill(null), {
      lat: 0,
      lng: 0,
      windowHours: 1
    })).not.toThrow();
  });

  test('from timestamp is interpreted as UTC when an ISO offset is supplied', () => {
    const result = predictPassesForRecords([], {
      lat: 0,
      lng: 0,
      from: '2019-06-05T00:00:00+00:00',
      windowHours: 1
    });
    expect(result.window.from).toBe('2019-06-05T00:00:00.000Z');
  });
});
