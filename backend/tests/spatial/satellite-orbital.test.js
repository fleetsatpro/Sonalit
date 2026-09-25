'use strict';

const {
  ALLOWED_GROUPS,
  selectedGroup,
  parseTleEpoch,
  parseTleCatalog,
  normaliseRecord,
  propagateSatellite,
  getProviderHealth
} = require('../../src/services/spatial/celestrakGateway');

const ISS_TLE_1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const ISS_TLE_2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';

describe('CelesTrak satellite/orbital adapter', () => {
  test('uses an allowlisted default and rejects arbitrary groups', () => {
    expect(ALLOWED_GROUPS.has('stations')).toBe(true);
    expect(selectedGroup('stations')).toBe('stations');
    expect(selectedGroup('not-allowlisted')).toBe('stations');
  });

  test('parses a CelesTrak TLE/3LE catalog into propagation-ready records', () => {
    const text = [
      'ISS (ZARYA)',
      ISS_TLE_1,
      ISS_TLE_2,
      'TEST SATELLITE',
      '1 12345U 98001A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
      '2 12345  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618123450'
    ].join('\n');

    const records = parseTleCatalog(text);
    expect(records).toHaveLength(2);
    expect(records[0].NORAD_CAT_ID).toBe(25544);
    expect(records[0].TLE_LINE1).toBe(ISS_TLE_1);
    expect(records[0].TLE_LINE2).toBe(ISS_TLE_2);
    expect(parseTleEpoch(ISS_TLE_1)).toBe('2019-06-05T12:12:58.000032Z');
  });

  test('normalises TLE records without inventing telemetry', () => {
    const satellite = normaliseRecord({
      OBJECT_NAME: 'ISS (ZARYA)',
      NORAD_CAT_ID: 25544,
      EPOCH: parseTleEpoch(ISS_TLE_1),
      TLE_LINE1: ISS_TLE_1,
      TLE_LINE2: ISS_TLE_2,
      INCLINATION: 51.6433,
      RA_OF_ASC_NODE: 59.2583,
      ECCENTRICITY: 0.0008217,
      ARG_OF_PERICENTER: 16.4489,
      MEAN_ANOMALY: 347.6017,
      MEAN_MOTION: 15.51174618
    }, 'stations');

    expect(satellite).toBeTruthy();
    expect(satellite.latitude).toBeUndefined();
    expect(satellite.longitude).toBeUndefined();
    expect(satellite.propagatorAvailable).toBe(true);
    expect(satellite.imagingClaim).toBe(false);
    expect(satellite.taskingClaim).toBe(false);
    expect(satellite.nonImagingSemantics).toBe(true);
    expect(satellite.tle.line1).toBe(ISS_TLE_1);
    expect(satellite.orbit.meanMotionRevPerDay).toBeCloseTo(15.51174618, 7);
    expect(satellite.provenance.sourceName).toBe('CelesTrak');
  });

  test('production satellite.js path produces finite modelled orbital coordinates', () => {
    const satellite = normaliseRecord({
      OBJECT_NAME: 'ISS (ZARYA)',
      NORAD_CAT_ID: 25544,
      EPOCH: parseTleEpoch(ISS_TLE_1),
      TLE_LINE1: ISS_TLE_1,
      TLE_LINE2: ISS_TLE_2
    }, 'stations');

    const position = propagateSatellite(satellite, new Date('2019-06-05T12:12:58.000032Z'));
    expect(position).toBeTruthy();
    expect(Number.isFinite(position.latitude)).toBe(true);
    expect(Number.isFinite(position.longitude)).toBe(true);
    expect(Number.isFinite(position.altitudeM)).toBe(true);
    expect(position.altitudeM).toBeGreaterThan(250000);
    expect(position.altitudeM).toBeLessThan(500000);
  });

  test('propagation helper fails closed without a TLE/SGP4 result', () => {
    expect(propagateSatellite({ tle: null }, new Date('2026-09-25T12:00:00.000Z'))).toBeNull();
  });

  test('provider health reports production propagator availability after dependency load', () => {
    const health = getProviderHealth();
    expect(health.providerId).toBe('celestrak');
    expect(health.propagatorAvailable).toBe(true);
  });
});
