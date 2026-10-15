import { test, expect, type Page } from '@playwright/test';

const WEATHER_POINT = {
  id: 'weather-studio-e2e-point',
  entityType: 'weather',
  source: 'Open-Meteo',
  sourceReference: 'https://open-meteo.com/en/docs',
  latitude: 0,
  longitude: 28,
  observedAt: null,
  receivedAt: '2026-10-15T07:00:00.000Z',
  status: 'MODELLED_FORECAST',
  quality: { state: 'modelled', freshnessClass: 'MODELLED', reason: 'E2E fixture — never production data' },
  attributes: {
    name: 'Weather Studio test forecast',
    weatherCode: 1,
    conditions: 'mainly_clear',
    temperatureC: 25,
    precipitationMm: 0,
    windSpeedKmh: 12,
    windDirectionDeg: 90,
    visibilityKm: 10,
    validAt: '2026-10-15T08:00:00.000Z',
    forecastSteps: [
      { validAt: '2026-10-15T08:00:00.000Z', weatherCode: 1, conditions: 'mainly_clear', temperatureC: 25, precipitationMm: 0, windSpeedKmh: 12, windDirectionDeg: 90, visibilityKm: 10 },
      { validAt: '2026-10-15T09:00:00.000Z', weatherCode: 61, conditions: 'light_rain', temperatureC: 22, precipitationMm: 1.2, windSpeedKmh: 18, windDirectionDeg: 100, visibilityKm: 8 },
    ],
  },
};

const SECOND_WEATHER_POINT = {
  ...WEATHER_POINT,
  id: 'weather-studio-e2e-point-2',
  latitude: 1.2,
  longitude: 29.4,
  attributes: { ...WEATHER_POINT.attributes, name: 'Weather Studio secondary grid point', windSpeedKmh: 28, windDirectionDeg: 125 },
};

function fixture(overallStatus: 'AVAILABLE' | 'PARTIAL') {
  return {
    data: [WEATHER_POINT, SECOND_WEATHER_POINT],
    generatedAt: '2026-10-15T07:00:00.000Z',
    health: {
      status: overallStatus,
      weather: { status: 'MODELLED', source: 'Open-Meteo', recordCount: 1 },
      earthquakes: { status: 'LIVE', recordCount: 0 },
      volcanoes: { status: 'LIVE', recordCount: 0 },
      eonet: { status: 'LIVE', recordCount: 0 },
      weatherAlerts: { status: overallStatus === 'PARTIAL' ? 'UNAVAILABLE' : 'AVAILABLE', recordCount: 0, activeCount: 0, scheduledCount: 0 },
    },
    weatherAlerts: {
      source: 'Kenya Meteorological Department CAP feed',
      sourceUrl: 'https://meteo.go.ke/api/cap/rss.xml',
      scope: 'Kenya national meteorological warning feed; this is not global alert coverage',
      status: overallStatus === 'PARTIAL' ? 'UNAVAILABLE' : 'AVAILABLE',
      receivedAt: '2026-10-15T07:00:00.000Z',
      recordCount: 0, activeCount: 0, scheduledCount: 0, alerts: [],
      semantics: 'Test fixture only.',
    },
    coverage: { weatherForecastPoints: 1, forecastHours: 1 },
    sources: { weather: 'https://open-meteo.com/en/docs' },
    warnings: overallStatus === 'PARTIAL' ? ['kenya_kmd_cap_feed_unavailable'] : [],
  };
}

async function openWeatherStudio(page: Page, status: 'AVAILABLE' | 'PARTIAL', options: { primaryTilesFail?: boolean } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('sonalit-auth', JSON.stringify({
      state: { user: { id: 'weather-e2e-user', name: 'Weather QA', email: 'weather-qa@sonalit.test', role: 'admin', org_id: 'weather-e2e-org' } },
      version: 0,
    }));
  });
  await page.route(url => url.toString().includes('/spatial/live-events'), route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: fixture(status) }),
  }));
  // Deterministic primary/fallback tile behavior exercises MapLibre's real error path.
  await page.route('https://services.arcgisonline.com/**', route => options.primaryTilesFail
    ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'Simulated primary tile outage' })
    : route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/VN0AAAAASUVORK5CYII=', 'base64') }));
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({
    status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+/VN0AAAAASUVORK5CYII=', 'base64'),
  }));
  await page.goto('/weather-studio');
  await expect(page.getByRole('heading', { name: /weather studio/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Inspect CLEAR \/ MOSTLY CLEAR: Weather Studio test forecast/i })).toBeVisible({ timeout: 15000 });
}

test.describe('Weather Studio route and operational controls', () => {
  test('renders sourced forecast points and keeps partial provider coverage distinct from loading', async ({ page }) => {
    await openWeatherStudio(page, 'PARTIAL');
    await expect(page.locator('.wx-coverage-state')).toHaveAttribute('data-state', 'partial');
    await expect(page.getByText('PARTIAL COVERAGE', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /weather models/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.wx-map-provider')).toContainText('ESRI CARTOGRAPHY');
    await expect(page.getByRole('button', { name: /wind flow/i })).toBeEnabled();
    await expect(page.getByText(/official feed could not be verified/i)).toBeVisible();
  });

  test('forecast point inspection, layer toggling and hourly playback work', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE');
    await page.getByRole('button', { name: /Inspect CLEAR \/ MOSTLY CLEAR: Weather Studio test forecast/i }).click();
    await expect(page.getByRole('heading', { name: 'CLEAR / MOSTLY CLEAR' })).toBeVisible();
    await expect(page.getByText('25°C', { exact: true })).toBeVisible();

    const weatherLayer = page.getByRole('button', { name: /weather models/i });
    await weatherLayer.click();
    await expect(weatherLayer).toHaveAttribute('aria-pressed', 'false');
    await weatherLayer.click();
    await expect(weatherLayer).toHaveAttribute('aria-pressed', 'true');

    const slider = page.getByRole('slider', { name: /select forecast valid time/i });
    await expect(slider).toBeEnabled();
    await slider.focus();
    await slider.press('End');
    await expect(page.getByText('22°C', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Play forecast timeline' }).click();
    await expect(page.getByRole('button', { name: 'Pause forecast timeline' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause forecast timeline' }).click();
  });
 

  test('fills the desktop viewport with a substantial map workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openWeatherStudio(page, 'AVAILABLE');
    const geometry = await page.evaluate(() => {
      const studio = document.querySelector('.wx-studio')?.getBoundingClientRect();
      const map = document.querySelector('.wx-map-canvas')?.getBoundingClientRect();
      return { viewportHeight: window.innerHeight, studioHeight: studio?.height ?? 0, mapHeight: map?.height ?? 0 };
    });
    expect(Math.abs(geometry.studioHeight - geometry.viewportHeight)).toBeLessThanOrEqual(2);
    expect(geometry.mapHeight).toBeGreaterThanOrEqual(420);
  });

  test('uses readable type hierarchy and puts official warnings before secondary panels', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE');
    const titleSize = Number.parseFloat(await page.locator('.wx-brand-copy h1').evaluate(el => getComputedStyle(el).fontSize));
    const controlSize = Number.parseFloat(await page.getByRole('button', { name: /weather models/i }).evaluate(el => getComputedStyle(el).fontSize));
    expect(titleSize).toBeGreaterThanOrEqual(26);
    expect(controlSize).toBeGreaterThanOrEqual(12);
    const cardTitles = await page.locator('.wx-right-column .wx-card-heading h2').allTextContents();
    expect(cardTitles[0]).toContain('Kenya · Official alerts');
  });


  test('falls back to independent cartography when primary map tiles fail', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE', { primaryTilesFail: true });
    await expect(page.locator('.wx-map-provider')).toHaveAttribute('data-provider', 'fallback', { timeout: 15000 });
    await expect(page.locator('.wx-map-provider')).toContainText('RESILIENT BASE');
    await expect(page.getByRole('button', { name: /Inspect CLEAR \/ MOSTLY CLEAR: Weather Studio test forecast/i })).toBeVisible();
  });

  test('remains usable without horizontal overflow on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWeatherStudio(page, 'AVAILABLE');
    await expect(page.getByRole('heading', { name: /weather studio/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /weather models/i })).toBeVisible();
    await expect(page.getByRole('slider', { name: /select forecast valid time/i })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });

});
