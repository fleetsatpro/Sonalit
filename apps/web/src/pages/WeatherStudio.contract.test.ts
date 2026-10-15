import { describe, expect, it } from 'vitest';
import { shouldRetrySpatialRequest, snapSpatialBounds } from '../lib/spatialClient.js';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./WeatherStudio.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles/weather-studio.css', import.meta.url), 'utf8');
const router = readFileSync(new URL('../router.tsx', import.meta.url), 'utf8');
const rail = readFileSync(new URL('../components/layout/Rail.tsx', import.meta.url), 'utf8');
const windField = readFileSync(new URL('../components/weather/WeatherFieldCanvas.tsx', import.meta.url), 'utf8');

describe('Weather Studio evidence and interaction contract', () => {
  it('uses the existing source-backed event API and forecast-valid timestamps', () => {
    expect(page).toContain('fetchLiveEventSimulation');
    expect(page).toContain('bounds: roundedBounds');
    expect(page).toContain('center: queryCenter');
    expect(page).toContain('queryRadiusM');
    expect(page).toContain('setQueryViewport');
    expect(page).toContain('snapSpatialBounds');
    expect(page).toContain('placeholderData: previousData => previousData');
    expect(page).toContain('refetchOnWindowFocus: false');
    expect(page).toContain("response.health?.status === 'PARTIAL' ? 'partial'");
    expect(page).toContain("liveQuery.isError ? 'partial' : 'available'");
    expect(page).toContain('The last successful snapshot is retained');
    expect(page).toContain('disabled={liveQuery.isFetching || isRateLimited}');
    expect(page).toContain("status === 'partial' ? 'PARTIAL COVERAGE'");
    expect(styles).toContain('.wx-coverage-state[data-state="partial"]');
    expect(page).toContain('forecastSteps');
    expect(page).toContain('validAt');
    expect(page).toContain('this is not a measured historical replay');
    expect(page).toContain('not a radar return');
  });

  it('stabilizes viewport bounds and does not retry API rate limits', () => {
    const bounds: [number, number, number, number] = [36.61, -1.39, 37.01, -1.19];
    const snapped = snapSpatialBounds(bounds);
    expect(snapped).toEqual([36.5, -1.5, 37.25, -1]);
    expect(snapped[0]).toBeLessThanOrEqual(bounds[0]);
    expect(snapped[1]).toBeLessThanOrEqual(bounds[1]);
    expect(snapped[2]).toBeGreaterThanOrEqual(bounds[2]);
    expect(snapped[3]).toBeGreaterThanOrEqual(bounds[3]);
    expect(snapSpatialBounds([36.61, -1.39, 37.01, -1.19]))
      .toEqual(snapSpatialBounds([36.64, -1.36, 37.04, -1.16]));
    expect(shouldRetrySpatialRequest(0, { response: { status: 429 } })).toBe(false);
    expect(shouldRetrySpatialRequest(0, { response: { status: 503 } })).toBe(true);
    expect(shouldRetrySpatialRequest(1, { response: { status: 503 } })).toBe(false);
  });

  it('offers separately controllable weather, earthquake, volcano and natural-event layers', () => {
    for (const name of ['weather', 'earthquakes', 'volcanoes', 'natural']) expect(page).toContain(name);
    expect(page).toContain('USGS ComCat');
    expect(page).toContain('NASA EONET');
    expect(page).toContain('sourceReference');
  });

  it('keeps condition markers static and respects reduced motion for the source-derived field', () => {
    expect(windField).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(page).toContain("button.innerHTML = '<span class=\"wx-marker__icon\">");
    expect(page).not.toContain('data-animate');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).not.toContain('wx-marker__signal');
    expect(styles).not.toContain('wx-marker__particles');
  });

  it('is routed and discoverable through the app navigation', () => {
    expect(router).toContain("path:'/weather-studio'");
    expect(router).toContain("import('./pages/WeatherStudio.js')");
    expect(rail).toContain("path:'/weather-studio',icon:CloudSun,label:'Weather Studio'");
  });

  it('renders a bounded, source-derived wind-flow field without faking radar imagery', () => {
    expect(page).toContain('WeatherFieldCanvas');
    expect(page).toContain('MODEL-DERIVED');
    expect(page).toContain('no radar imagery');
    expect(windField).toContain('windDirectionDeg');
    expect(windField).toContain('map.getCanvasContainer()');
    expect(windField).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(windField).toContain("document.addEventListener('visibilitychange'");
    expect(windField).toContain('window.setTimeout');
    expect(styles).toContain('.wx-field-overlay');
  });

  it('keeps the layout responsive and the forecast map legible on small screens', () => {
    expect(styles).toContain('@media (max-width: 900px)');
    expect(styles).toContain('@media (max-width: 620px)');
    expect(styles).toContain('.wx-map-canvas');
    expect(styles).toContain('.wx-map-legend');
    expect(styles).toContain('.wx-field-label');
    expect(page).toContain('NASA_RASTER_PRODUCTS');
    expect(page).toContain('IMERG_Precipitation_Rate_v7_NRT');
    expect(page).toContain('MODIS_Aqua_CorrectedReflectance_TrueColor');
    expect(page).toContain('syncNasaRasterLayers');
    expect(page).toContain('weatherAlerts');
    expect(page).toContain('Kenya · Official alerts');
    expect(page).toContain('National coverage only');
    expect(styles).toContain('.wx-warning-card');
    expect(styles).toContain('.wx-observation-note');
    expect(page).toContain('FALLBACK_STREET_STYLE');
    expect(page).toContain('typeof rendererSupportCheck === \'function\'');
    expect(page).toContain('setMapAttempt(value => value + 1)');
    expect(page).toContain('wx-map-provider');
    expect(page).toContain('flowMotion');
    expect(styles).toContain('.wx-map-provider');
  });

  it('does not synthesize decorative storm flashes or marker particles', () => {
    expect(styles).not.toContain('wx-flash');
    expect(styles).not.toContain('wx-marker__particles');
    expect(styles).not.toContain('wx-marker__signal');
    expect(page).toContain("label: 'THUNDERSTORM'");
  });



  it('separates forecast controls and makes detailed source lineage available on demand', () => {
    expect(page).toContain('wx-toolbar-primary');
    expect(page).toContain('wx-toolbar-secondary');
    expect(page).toContain('<details className="wx-card wx-source-card"');
    expect(page).toContain('wx-source-summary');
    expect(styles).toContain('.wx-warning-card .wx-warning-list');
    expect(styles).toContain('.wx-toolbar-secondary');
  });


  it('keeps the map key outside the map viewport and observation notices inside the canvas', () => {
    const canvasStart = page.indexOf('<div className="wx-map-canvas">');
    const canvasEnd = page.indexOf('          </div>\n          {!mapReady && !mapError', canvasStart);
    const keyPosition = page.indexOf('<div className="wx-map-legend"');
    expect(canvasStart).toBeGreaterThanOrEqual(0);
    expect(canvasEnd).toBeGreaterThan(canvasStart);
    expect(keyPosition).toBeGreaterThan(canvasEnd);
    expect(page.slice(canvasStart, canvasEnd)).toContain('className="wx-observation-note"');
    expect(page.slice(canvasStart, canvasEnd)).toContain('className="wx-map-notice wx-raster-notice"');
    expect(styles).toContain('.wx-map-legend {');
    expect(styles).not.toContain('position:absolute; top:12px; right:12px; left:auto;');
  });


  it('renders the map-first three-zone operator desk with controls isolated from the map canvas', () => {
    expect(page).toContain('wx-layer-rail');
    expect(page).toContain('wx-workspace--desk');
    expect(page).toContain('wx-toolbar-primary');
    expect(page).toContain('wx-toolbar-secondary');
    expect(page).toContain('wx-layer-button__copy');
    expect(page).toContain('Source-first display');
    expect(styles).toContain('grid-template-areas: "layers map right"');
    expect(styles).toContain('.wx-layer-rail');
    expect(styles).toContain('@media (max-width: 900px)');
  });


  it('locks in the broadcast-console visual system and preserves map instruments', () => {
    expect(styles).toContain('--wx-bg: #071019');
    expect(styles).toContain('--wx-cyan: #69dce7');
    expect(styles).toContain('--wx-red: #ff625e');
    expect(styles).toContain("'Barlow Condensed', Inter, sans-serif");
    expect(styles).toContain("'JetBrains Mono'");

    expect(styles).toContain('.wx-marker__icon');
    expect(styles).toContain('.wx-field-overlay {');
    expect(styles).toContain('.wx-map-legend {');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).not.toContain('radial-gradient');
    expect(styles).not.toContain('--sp-violet');
    expect(styles).not.toContain('wx-marker__signal');
    expect(styles).not.toContain('wx-marker__particles');
  });
});
