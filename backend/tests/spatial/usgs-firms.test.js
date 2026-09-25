'use strict';

const {
  normalizeFeature: normalizeEarthquake,
  getEarthquakes
} = require('../../src/services/spatial/usgsEarthquakeGateway');

const {
  normalizeDetection,
  parseCsv,
  getFireDetections
} = require('../../src/services/spatial/nasaFirmsGateway');

describe('USGS earthquake gateway', () => {
  test('normalizes GeoJSON earthquake evidence and keeps impact confidence low', () => {
    const obs = normalizeEarthquake({
      id:'us700000test',
      geometry:{type:'Point',coordinates:[151.2,-33.8,12.4]},
      properties:{
        mag:5.2,
        magType:'mw',
        place:'Test region',
        time:Date.parse('2026-09-25T15:00:00Z'),
        updated:Date.parse('2026-09-25T15:01:00Z'),
        alert:'green',
        felt:4,
        sig:430,
        status:'review',
        type:'earthquake'
      }
    },'2026-09-25T15:01:20Z');

    expect(obs).not.toBeNull();
    expect(obs.entityType).toBe('natural_hazard');
    expect(obs.source).toBe('usgs-earthquake');
    expect(obs.attributes.hazardType).toBe('earthquake');
    expect(obs.attributes.magnitude).toBe(5.2);
    expect(obs.quality.freshnessClass).toBe('LIVE');
    expect(obs.operationalConfidence).toBeLessThan(0.5);
    expect(obs.uncertainty.join(' ')).toMatch(/impact/i);
  });

  test('rejects invalid earthquake coordinates', () => {
    expect(normalizeEarthquake({
      id:'bad',
      geometry:{type:'Point',coordinates:[999,0,0]},
      properties:{mag:4,time:Date.now()}
    },new Date().toISOString())).toBeNull();
  });
});

describe('NASA FIRMS gateway', () => {
  test('parses CSV and normalizes VIIRS hotspot detections', () => {
    const csv = [
      'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
      '-1.3000,36.8400,320,0.4,0.5,2026-09-25,1500,NOAA-21,VIIRS,high,2.0,290,18.5,D'
    ].join('\n');
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    const obs = normalizeDetection(rows[0],'2026-09-25T15:01:00Z');
    expect(obs).not.toBeNull();
    expect(obs.entityType).toBe('natural_hazard');
    expect(obs.source).toBe('nasa-firms');
    expect(obs.attributes.hazardType).toBe('fire_hotspot');
    expect(obs.attributes.satellite).toBe('NOAA-21');
    expect(obs.observationConfidence).toBeGreaterThan(0.8);
    expect(obs.operationalConfidence).toBeLessThan(0.5);
    expect(obs.quality.freshnessClass).toBe('LIVE');
    expect(obs.uncertainty.join(' ')).toMatch(/hotspot/i);
  });

  test('requires MAP_KEY and fails honestly without credentials', async () => {
    const previous = process.env.NASA_FIRMS_MAP_KEY;
    delete process.env.NASA_FIRMS_MAP_KEY;
    await expect(getFireDetections({
      bbox:[36.7,-1.4,36.9,-1.2],
      maxRecords:10
    })).rejects.toMatchObject({failureClass:'auth_required'});
    if(previous == null) delete process.env.NASA_FIRMS_MAP_KEY;
    else process.env.NASA_FIRMS_MAP_KEY = previous;
  });

  test('accepts valid bounded earthquake query input before provider fetch', async () => {
    await expect(getEarthquakes({bbox:[36.7,-1.4,36.9,-1.2],maxRecords:5,signal:(new AbortController()).signal})).resolves.toBeDefined();
  });
});
