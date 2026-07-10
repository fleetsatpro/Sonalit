import type maplibregl from 'maplibre-gl';

// Plain raster tiles — no vector-style/glyph fetch to fail, unlike a hosted
// vector style (e.g. cartocdn dark-matter) which can silently fail to
// render tiles depending on network/CSP conditions. Uses Esri's street tile
// service (same provider as the satellite style below) rather than
// tile.openstreetmap.org directly — OSM's own demo tile server explicitly
// discourages/rate-limits production traffic, which is a common source of
// tiles silently failing to load in a deployed app.
export const STREET_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: { street: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri, HERE, Garmin, USGS, NGA, EPA, USDA' } },
  layers: [{ id: 'street-tiles', type: 'raster', source: 'street' as const, paint: { 'raster-opacity': 1 } }],
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
