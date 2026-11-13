import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./mapLabels.ts', import.meta.url), 'utf8');

describe('shared map label treatment', () => {
  it('recognises place, road, water and point-of-interest labels', () => {
    expect(source).toContain('const PLACE_LABEL');
    expect(source).toContain('const ROAD_LABEL');
    expect(source).toContain('const WATER_LABEL');
    expect(source).toContain('const POI_LABEL');
  });

  it('raises label size and contrast while preserving map collision avoidance', () => {
    expect(source).toContain("map.setLayoutProperty(layer.id, 'text-size'");
    expect(source).toContain("map.setPaintProperty(layer.id, 'text-halo-width', 1.4)");
    expect(source).not.toContain("'text-allow-overlap'");
    expect(source).not.toContain("'text-ignore-placement'");
  });

  it('reapplies the treatment after every style load', () => {
    expect(source).toContain("map.on('style.load', apply)");
    expect(source).toContain("map.off('style.load', apply)");
  });
});
