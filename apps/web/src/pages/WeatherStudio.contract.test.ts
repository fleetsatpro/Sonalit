import { describe, expect, it } from 'vitest';
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
    expect(page).toContain("response.health?.status === 'PARTIAL' ? 'partial'");
    expect(page).toContain("status === 'partial' ? 'PARTIAL COVERAGE'");
    expect(styles).toContain('.wx-coverage-state[data-state="partial"]');
    expect(page).toContain('forecastSteps');
    expect(page).toContain('validAt');
    expect(page).toContain('this is not a measured historical replay');
    expect(page).toContain('not a radar return');
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
    expect(page).toContain('maplibregl.supported()');
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


});
