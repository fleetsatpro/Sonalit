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
    expect(page).toContain('bounds: viewport.bounds');
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

  it('does not animate stale or unknown data and respects reduced motion', () => {
    expect(page).toContain("'(prefers-reduced-motion: reduce)'");
    expect(page).toContain("['LIVE', 'DELAYED', 'MODELLED'].includes(freshness)");
    expect(styles).toContain('@media(prefers-reduced-motion:reduce)');
    expect(styles).toContain('data-animate="false"');
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
    expect(styles).toContain('@media(max-width:850px)');
    expect(styles).toContain('@media(max-width:560px)');
    expect(styles).toContain('.wx-map-canvas');
    expect(styles).toContain('.wx-map-legend');
    expect(styles).toContain('.wx-field-label');
  });
});
