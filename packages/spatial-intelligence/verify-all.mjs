import assert from 'node:assert/strict';
import { EntityRegistry } from './src/cesium/EntityRegistry.ts';
import { classifyFreshness, buildQuality, isValidLatLon } from './src/model/observation.ts';
import { suggestContextRadiusM } from './src/context/worldContext.ts';

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

console.log('Spatial package verification complete.');
