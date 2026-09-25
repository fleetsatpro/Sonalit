import assert from 'node:assert/strict';
import { EntityRegistry } from './src/cesium/EntityRegistry.ts';
import { classifyFreshness, buildQuality, isValidLatLon } from './src/model/observation.ts';
import { suggestContextRadiusM } from './src/context/worldContext.ts';
import {
  classifySatelliteLod,
  selectSatellitesForLod,
  satelliteGeoJson,
} from './src/cesium/SatelliteLod.ts';

function test(name, fn) {
  fn();
  console.log('PASS', name);
}

test('EntityRegistry keeps semantic and Cesium reverse mappings consistent', () => {
  const registry = new EntityRegistry();
  registry.register({ id: 'external:a', domain: 'external', entityType: 'aircraft', cesiumId: 'cesium:a' });
  assert.equal(registry.getByCesiumId('cesium:a')?.id, 'external:a');

  registry.register({ id: 'external:a', domain: 'external', entityType: 'aircraft', cesiumId: 'cesium:b' });
  assert.equal(registry.getByCesiumId('cesium:a'), undefined);
  assert.equal(registry.getByCesiumId('cesium:b')?.id, 'external:a');

  registry.register({ id: 'external:b', domain: 'external', entityType: 'vessel', cesiumId: 'cesium:b' });
  assert.equal(registry.getByCesiumId('cesium:b')?.id, 'external:b');
  assert.equal(registry.get('external:a')?.cesiumId, undefined);
});

test('EntityRegistry selection is cleared when its entity is unregistered', () => {
  const registry = new EntityRegistry();
  registry.register({ id: 'vehicle:1', domain: 'sonalit', entityType: 'vehicle', cesiumId: 'v:1' });
  const selected = registry.get('vehicle:1');
  assert.ok(selected);
  registry.select(selected);
  assert.equal(registry.getSelection()?.entity.id, 'vehicle:1');
  registry.unregister('vehicle:1');
  assert.equal(registry.getSelection(), null);
  assert.equal(registry.size(), 0);
});

test('freshness preserves unknown timestamps and classifies deterministic ages', () => {
  const received = '2026-09-24T12:00:00.000Z';
  assert.equal(classifyFreshness(null, received), 'UNKNOWN');
  assert.equal(classifyFreshness('2026-09-24T11:59:45.000Z', received), 'LIVE');
  assert.equal(classifyFreshness('2026-09-24T11:55:00.000Z', received), 'DELAYED');
  assert.equal(classifyFreshness('2026-09-24T11:40:00.000Z', received), 'STALE');
});

test('quality state follows freshness without fabricating certainty', () => {
  assert.equal(buildQuality('UNKNOWN').state, 'unknown');
  assert.equal(buildQuality('LIVE').state, 'good');
  assert.equal(buildQuality('STALE').state, 'stale');
});

test('geographic validation rejects impossible coordinates', () => {
  assert.equal(isValidLatLon(1.2, 36.8), true);
  assert.equal(isValidLatLon(91, 36.8), false);
  assert.equal(isValidLatLon(-1.2, 181), false);
});

test('context radius adapts to scenario and movement', () => {
  assert.equal(suggestContextRadiusM({ scenario: 'immediate' }), 5000);
  assert.ok(suggestContextRadiusM({ scenario: 'local', convoySpeedMps: 25 }) > 25000);
  assert.ok(suggestContextRadiusM({ scenario: 'local', routeLengthM: 500000 }) >= 75000);
});

const satelliteFixture = (id, confidence = 0.9) => ({
  id,
  entityType: 'satellite',
  source: 'celestrak',
  sourceReference: id,
  latitude: -1.29,
  longitude: 36.82,
  observedAt: null,
  receivedAt: '2026-09-25T20:00:00.000Z',
  observationConfidence: confidence,
  attributes: {
    id,
    name: id,
    noradCatalogId: 25544,
    positionMode: 'SGP4_PROPAGATED',
    positionSource: 'modelled',
    imagingClaim: false,
    taskingClaim: false,
    nonImagingSemantics: true,
  },
  provenance: { sourceName: 'CelesTrak' },
  quality: { state: 'degraded', freshnessClass: 'MODELLED' },
});

test('satellite LOD switches deterministically by camera height', () => {
  assert.equal(classifySatelliteLod(2_500_000), 'detail');
  assert.equal(classifySatelliteLod(2_500_001), 'label');
  assert.equal(classifySatelliteLod(10_000_000), 'label');
  assert.equal(classifySatelliteLod(10_000_001), 'point');
  assert.equal(classifySatelliteLod(50_000_000), 'point');
  assert.equal(classifySatelliteLod(50_000_001), 'hidden');
});

test('satellite LOD enforces render budgets and non-claim semantics', () => {
  const satellites = Array.from({ length: 60 }, (_, i) => satelliteFixture('sat:' + String(i).padStart(2, '0'), 1 - i / 1000));
  assert.equal(selectSatellitesForLod(satellites, 1_000_000).length, 4);
  assert.equal(selectSatellitesForLod(satellites, 5_000_000).length, 12);
  assert.equal(selectSatellitesForLod(satellites, 20_000_000).length, 40);
  assert.equal(selectSatellitesForLod(satellites, 60_000_000).length, 0);

  const feature = satelliteGeoJson(satelliteFixture('sat:proof'));
  assert.equal(feature.properties.telemetryLive, false);
  assert.equal(feature.properties.imagingClaim, false);
  assert.equal(feature.properties.taskingClaim, false);
  assert.equal(feature.properties.positionSource, 'modelled');
  assert.match(String(feature.properties.caption), /not live telemetry/);
});

test('satellite LOD refuses a live-telemetry or imaging-claimed object', () => {
  const live = satelliteFixture('sat:live');
  live.attributes.imagingClaim = true;
  live.attributes.positionSource = 'telemetry';
  assert.equal(selectSatellitesForLod([live], 20_000_000).length, 0);
  assert.equal(satelliteGeoJson(live), null);
});

console.log('Spatial package verification complete.');
