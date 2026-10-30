import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./mapStyles.ts', import.meta.url), 'utf8');

describe('map style provider contracts', () => {
  it('uses OpenFreeMap dark vector cartography for the SJM dark basemap', () => {
    expect(source).toContain("export const DARK_STREET_STYLE = 'https://tiles.openfreemap.org/styles/dark' as const;");
  });

  it('uses a distinct keyless provider for the map fallback', () => {
    expect(source).toContain("export const FALLBACK_STREET_STYLE = 'https://tiles.openfreemap.org/styles/liberty' as const;");
  });

  it('does not use unauthenticated CARTO raster endpoints that return key-required watermarks', () => {
    expect(source).not.toContain('basemaps.cartocdn.com/dark_all');
  });
});
