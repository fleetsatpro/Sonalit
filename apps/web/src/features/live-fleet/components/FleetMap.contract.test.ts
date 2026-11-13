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
