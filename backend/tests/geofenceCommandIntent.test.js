'use strict';

const { inferGeofenceTask } = require('../src/utils/geofenceCommandIntent');

describe('deterministic Copilot geofence command intent', () => {
  test('routes named-place polygon requests to autonomous polygon execution', () => {
    expect(inferGeofenceTask('Draw a polygon boundary around Nairobi')).toMatchObject({
      task: 'create_geofence', location: 'Nairobi', shape: 'polygon', precision: 'maximum',
    });
    expect(inferGeofenceTask('Create a 2km polygon geofence around Nairobi')).toMatchObject({
      location: 'Nairobi', shape: 'polygon', radius_m: 2000,
    });
    expect(inferGeofenceTask('Draw a custom area around the depot')).toMatchObject({
      location: 'the depot', shape: 'polygon',
    });
  });

  test('distinguishes a requested official boundary from an approximation', () => {
    expect(inferGeofenceTask('Create the official administrative boundary around Nairobi')).toMatchObject({
      location: 'Nairobi', shape: 'boundary',
    });
    expect(inferGeofenceTask('Draw a city boundary around Nairobi')).toMatchObject({
      location: 'Nairobi', shape: 'boundary',
    });
    expect(inferGeofenceTask('Create a geofence around Nairobi')).toMatchObject({
      location: 'Nairobi', shape: 'circle', radius_m: 3000,
    });
  });

  test('preserves route corridors, buffer values and route endpoints', () => {
    expect(inferGeofenceTask('Create a corridor geofence from Nairobi to Mombasa with 500m buffer')).toMatchObject({
      location: 'Nairobi', route_end: 'Mombasa', buffer_m: 500,
    });
  });

  test('supports coordinates and common location prepositions', () => {
    expect(inferGeofenceTask('Create a 2km polygon at -1.2864, 36.8172')).toMatchObject({
      location: '-1.2864,36.8172', shape: 'polygon', radius_m: 2000,
    });
    expect(inferGeofenceTask('Build a zone in Nairobi')).toMatchObject({ location: 'Nairobi' });
    expect(inferGeofenceTask('Create a geofence for the main depot')).toMatchObject({ location: 'the main depot' });
  });

  test('ignores informational questions and requests without actionable location text', () => {
    expect(inferGeofenceTask('Which geofence covers Nairobi?')).toBeNull();
    expect(inferGeofenceTask('How do I create a geofence around Nairobi?')).toBeNull();
    expect(inferGeofenceTask('Create a risk zone around Nairobi')).toBeNull();
    expect(inferGeofenceTask('Mark Nairobi as a high-risk area')).toBeNull();
    expect(inferGeofenceTask('Draw a polygon')).toBeNull();
    expect(inferGeofenceTask('')).toBeNull();
  });
});
