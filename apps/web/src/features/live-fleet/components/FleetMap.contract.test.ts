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
    expect(source).toContain('clusterRadius: 30');
    expect(source).toContain('clusterMaxZoom: 7');
    expect(source).toContain("getClusterExpansionZoom(clusterId)");
    expect(source).toContain("item.id");
    expect(source).toContain("map.getZoom() <= 8.2 ? 'none' : ''");
    expect(source).toContain("deviceSource.setData({ type: 'FeatureCollection', features })");
  });

  it('uses the zoom-resilient shared vector basemap and caps Esri satellite tiles', () => {
    expect(source).toContain("import { STREET_STYLE } from '../../../lib/mapStyles.js'");
    expect(source).toContain('style: STREET_STYLE');
    expect(source).toContain("next === 'dark' ? STREET_STYLE");
    expect(source).not.toContain('World_Street_Map/MapServer/tile/');
    expect(source).toContain("anchor: 'center'");
    expect(source).toContain('subpixelPositioning: true');
    expect(source).not.toContain("anchor: 'left', offset: [-20, 0]");
    expect(source).toContain('maxzoom: 19');
    expect(source).not.toContain('maxzoom: 16');
    expect(source).not.toContain('maxzoom: 14');
  });
});
