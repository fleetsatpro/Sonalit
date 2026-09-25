'use strict';

const {
  ALLOWED_GROUPS,
  selectedGroup,
  normaliseRecord,
  propagateSatellite
} = require('../../src/services/spatial/celestrakGateway');

describe('CelesTrak satellite/orbital adapter', () => {
  test('uses an allowlisted default and rejects arbitrary groups', () => {
    expect(ALLOWED_GROUPS.has('stations')).toBe(true);
    expect(selectedGroup('stations')).toBe('stations');
    expect(selectedGroup('not-allowlisted')).toBe('stations');
  });

  test('normalises GP catalog records without inventing a ground position', () => {
    const satellite = normaliseRecord({
      OBJECT_NAME: 'ISS (ZARYA)',
      NORAD_CAT_ID: 25544,
      OBJECT_ID: '1998-067A',
      EPOCH: '2026-09-25T10:00:00.000Z',
      MEAN_MOTION: 15.5,
      ECCENTRICITY: 0.0005,
      INCLINATION: 51.6,
      RA_OF_ASC_NODE: 120,
      ARG_OF_PERICENTER: 240,
      MEAN_ANOMALY: 180,
      TLE_LINE1: '1 25544U 98067A   26268.50000000  .00000000  00000-0  00000-0 0  9999',
      TLE_LINE2: '2 25544  51.6000 120.0000 0005000 240.0000 180.0000 15.50000000123456'
    }, 'stations');

    expect(satellite).toBeTruthy();
    expect(satellite.latitude).toBeUndefined();
    expect(satellite.longitude).toBeUndefined();
    expect(satellite.imagingClaim).toBe(false);
    expect(satellite.taskingClaim).toBe(false);
    expect(satellite.nonImagingSemantics).toBe(true);
    expect(satellite.orbit.meanMotionRevPerDay).toBe(15.5);
    expect(satellite.provenance.sourceName).toBe('CelesTrak');
  });

  test('propagation helper fails closed without a TLE/SGP4 result', () => {
    expect(propagateSatellite({ tle: null }, new Date('2026-09-25T12:00:00.000Z'))).toBeNull();
  });
});
