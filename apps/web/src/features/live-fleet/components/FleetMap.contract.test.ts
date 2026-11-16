import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./FleetMap.tsx', import.meta.url), 'utf8');

describe('GEV 2D basemap contract', () => {
  it('keeps device map captions compact and preserves GPS and health age in marker details', () => {
    expect(source).toContain('function formatFixAge(secondsAgo: number)');
    expect(source).toContain("'GPS FIX ' + gpsAge + ' AGO'");
    expect(source).toContain("'SOS · ALERT ACTIVE'");
    expect(source).toContain("'STATIONARY') + batteryDetail");
    expect(source).not.toContain("'ONLINE · STATIONARY'");
  });

  it('keeps stale GPS distinct from a live device heartbeat and exposes measured accuracy', () => {
    expect(source).toContain("accuracyMeters: v.accuracy_m");
    expect(source).toContain("latitude: v.lat");
    expect(source).toContain("'GPS ACCURACY ±'");
    expect(source).toContain("'HEARTBEAT ONLINE · GPS FIX AGED'");
  });

  it('uses truthful point clustering before revealing individual devices at regional zoom', () => {
    expect(source).toContain("sourceId = 'lf-operational-devices'");
    expect(source).toContain('cluster: true');
    expect(source).toContain('clusterRadius: 42');
    expect(source).toContain('map.getZoom() <= 8');
    expect(source).toContain('clusterMaxZoom: 8');
    expect(source).toContain('initialDeviceFitRef');
    expect(source).toContain('function hasValidDeviceCoordinates');
    expect(source).not.toContain("map.getZoom() <= 8.2 ? 'none' : ''");
    expect(source).toContain('resolveOperationalDeviceState({');
    expect(source).toContain('minimalLongitudeBounds(longitudes)');
    expect(source).toContain('attributionControl: { compact: true }');
    expect(source).toContain("getClusterExpansionZoom(clusterId)");
    expect(source).toContain("item.id");
    expect(source).toContain("map.getZoom() <= 8 ? 'none' : ''");
    expect(source).toContain('1.2000°N 35.5000°E');
    expect(source).toContain("source.setData({ type: 'FeatureCollection', features })");
    expect(source).toContain("heading: v.status === 'move' ? normalizeHeadingDegrees(v.heading) : null");
  });

  it('uses the zoom-resilient shared vector basemap and caps Esri satellite tiles', () => {
    expect(source).toContain("import { DARK_STREET_STYLE } from '../../../lib/mapStyles.js'");
    expect(source).toContain('style: DARK_STREET_STYLE');
    expect(source).toContain("next === 'dark' ? DARK_STREET_STYLE");
    expect(source).not.toContain('World_Street_Map/MapServer/tile/');
    expect(source).toContain("anchor: 'center'");
    expect(source).toContain('subpixelPositioning: true');
    expect(source).not.toContain("anchor: 'left', offset: [-20, 0]");
    expect(source).toContain('maxzoom: 19');
    expect(source).not.toContain('maxzoom: 16');
    expect(source).not.toContain('maxzoom: 14');
  });
});
