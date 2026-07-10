import type maplibregl from 'maplibre-gl';

// Plain raster tiles — no vector-style/glyph fetch to fail, unlike a hosted
// vector style (e.g. cartocdn dark-matter) which can silently fail to
// render tiles depending on network/CSP conditions.
export const STREET_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' as const, paint: { 'raster-opacity': 1 } }],
};

// Satellite imagery + Esri reference layer (place names, country/admin boundaries, major roads)
export const SAT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri World Imagery' },
    'sat-ref': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri Boundaries and Places' },
  },
  layers: [
    { id: 'sat-tiles', type: 'raster', source: 'sat' as const, paint: { 'raster-opacity': 1 } },
    { id: 'sat-ref-tiles', type: 'raster', source: 'sat-ref' as const, paint: { 'raster-opacity': 0.9 } },
  ],
};
