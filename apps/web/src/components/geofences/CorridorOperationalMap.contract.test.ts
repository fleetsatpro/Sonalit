import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CorridorOperationalMap.tsx', import.meta.url), 'utf8');

describe('XD Live 2D basemap contract', () => {
  it('uses the deterministic local raster style instead of a hosted vector style', () => {
    expect(source).toContain("import { SAT_STYLE, STREET_STYLE } from '../../lib/mapStyles.js';");
    expect(source).toContain("return mode === 'satellite' || mode === 'hybrid' ? SAT_STYLE : STREET_STYLE;");
    expect(source).not.toContain('https://tiles.openfreemap.org/styles/liberty');
    expect(source).not.toContain('XD_VECTOR_STYLE');
  });
});
