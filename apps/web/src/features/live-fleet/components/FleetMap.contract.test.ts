import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./FleetMap.tsx', import.meta.url), 'utf8');

describe('GEV 2D basemap contract', () => {
  it('uses the deterministic Sonalit street raster for the default dark world canvas', () => {
    expect(source).toContain("import { STREET_STYLE } from '../../../lib/mapStyles.js'");
    expect(source).toContain('style: STREET_STYLE');
    expect(source).toContain("next === 'dark' ? STREET_STYLE");
    expect(source).not.toContain('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json');
  });
});
