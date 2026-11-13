import type maplibregl from 'maplibre-gl';

// Global street cartography is vector-based so the renderer can overzoom the
// provider's native tiles without surfacing Esri's raster "Map data not yet
// available" placeholder tiles. Liberty preserves a clear, light map with
// names, transport labels, water features and place hierarchy at every zoom.
export const STREET_STYLE = 'https://tiles.openfreemap.org/styles/liberty' as const;

// Satellite imagery + Esri reference layer (place names, country/admin boundaries, major roads).
// Uses services.arcgisonline.com (current canonical Esri tile host, same one the
// GPS Live page's FleetMap uses) rather than server.arcgisonline.com — the
// latter is a legacy alias that stops serving usable imagery past its lower
// native zoom, so deep zoom-ins fell back to blurry over-zoomed tiles. An
// explicit maxzoom stops MapLibre from requesting tile levels the service
// doesn't have, so it cleanly upsamples the deepest real tile instead of
// showing broken/blank ones.
export const SAT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tiles: ['sonalit-ai://satellite/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: '© Esri, Maxar, GeoEye, Earthstar Geographics' },
    'sat-ref': { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 14, attribution: '© Esri Reference Overlay' },
  },
  layers: [
    { id: 'sat-tiles', type: 'raster', source: 'sat' as const, paint: { 'raster-opacity': 1 } },
    { id: 'sat-ref-tiles', type: 'raster', source: 'sat-ref' as const, paint: { 'raster-opacity': 1 } },
  ],
};

/**
 * SJM dark vector cartography from OpenFreeMap. The provider publishes a
 * keyless MapLibre style and serves its own glyphs, sprites and vector tiles.
 * Route geometry and operational markers are added by the journey layer.
 */
export const DARK_STREET_STYLE = 'https://tiles.openfreemap.org/styles/dark' as const;

/**
 * Alternate keyless OpenFreeMap style. This is an alternate cartographic style
 * on the same tile service, not an independent network provider.
 */
export const FALLBACK_STREET_STYLE = 'https://tiles.openfreemap.org/styles/bright' as const;

