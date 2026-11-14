import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./mapStyles.ts', import.meta.url), 'utf8');

describe('map style provider contracts', () => {
  it('uses OpenFreeMap dark vector cartography for the SJM dark basemap', () => {
    expect(source).toContain("export const DARK_STREET_STYLE = 'https://tiles.openfreemap.org/styles/dark' as const;");
  });

  it('uses OpenFreeMap Liberty as the shared vector basemap and keeps Weather Studio ESRI-specific', () => {
    expect(source).toContain("export const STREET_STYLE = 'https://tiles.openfreemap.org/styles/liberty' as const;");
    expect(source).toContain('export const ESRI_STREET_STYLE: maplibregl.StyleSpecification');
    expect(source).toContain('services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile');
  });

  it('requests native imagery and reference tiles through their level-19 source ceiling', () => {
    expect(source).toContain("maxzoom: 19, attribution: '© Esri, Maxar, GeoEye, Earthstar Geographics'");
    expect(source).toContain("maxzoom: 19, attribution: '© Esri Reference Overlay'");
  });

  it('uses a documented alternate OpenFreeMap style rather than claiming an independent provider', () => {
    expect(source).toContain("export const FALLBACK_STREET_STYLE = 'https://tiles.openfreemap.org/styles/bright' as const;");
    expect(source).toContain('not an independent network provider');
  });

  it('does not use unauthenticated CARTO raster endpoints that return key-required watermarks', () => {
    expect(source).not.toContain('basemaps.cartocdn.com/dark_all');
  });
});
