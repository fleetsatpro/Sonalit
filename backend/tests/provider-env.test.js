'use strict';

const geoEnv = require('../src/services/geo/providerEnv');

const MAPBOX_VARS = ['MAPBOX_TOKEN', 'MAPBOX_ACCESS_TOKEN', 'MAPBOX_API_KEY', 'MAPBOX_KEY'];

describe('providerEnv.mapboxToken', () => {
  let saved;
  beforeEach(() => { saved = {}; for (const k of MAPBOX_VARS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of MAPBOX_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test('empty when none set', () => {
    expect(geoEnv.mapboxToken()).toBe('');
  });

  test.each(MAPBOX_VARS)('picks up %s', (name) => {
    process.env[name] = 'tok-' + name;
    expect(geoEnv.mapboxToken()).toBe('tok-' + name);
  });

  test('MAPBOX_TOKEN wins over the aliases', () => {
    process.env.MAPBOX_TOKEN = 'primary';
    process.env.MAPBOX_API_KEY = 'alias';
    expect(geoEnv.mapboxToken()).toBe('primary');
  });
});

describe('providerEnv.osrmUrl', () => {
  let saved;
  beforeEach(() => { saved = process.env.OSRM_URL; delete process.env.OSRM_URL; });
  afterEach(() => { if (saved === undefined) delete process.env.OSRM_URL; else process.env.OSRM_URL = saved; });

  test('defaults to the public OSRM server', () => {
    expect(geoEnv.osrmUrl()).toBe('https://router.project-osrm.org');
  });
  test('honours OSRM_URL when set', () => {
    process.env.OSRM_URL = 'http://osrm.internal';
    expect(geoEnv.osrmUrl()).toBe('http://osrm.internal');
  });
});
