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
      recordCount: overallStatus === 'PARTIAL' ? 0 : 1, activeCount: overallStatus === 'PARTIAL' ? 0 : 1, scheduledCount: 0,
      alerts: overallStatus === 'PARTIAL' ? [] : [{
        id: 'weather-studio-e2e-cap-warning',
        title: 'Test-only severe rainfall warning',
        severity: 'Severe',
        urgency: 'Immediate',
        activeState: 'ACTIVE',
        verifiedCap: true,
        source: 'Kenya Meteorological Department',
        areas: [{ description: 'Fixture-only western Kenya area', polygons: [[[18, -10], [40, -10], [40, 10], [18, 10], [18, -10]]] }],
      }],
      semantics: 'Test fixture only; polygon geometry is synthetic and never production data.',
    },
    coverage: { weatherForecastPoints: 1, forecastHours: 1 },
    sources: { weather: 'https://open-meteo.com/en/docs' },
    warnings: overallStatus === 'PARTIAL' ? ['kenya_kmd_cap_feed_unavailable'] : [],
  };
}

// Build a standards-valid 256×256 RGBA PNG in-process. This avoids static fixtures with mismatched IDAT/CRC data,
// which Chromium accepts as HTTP 200 bytes but MapLibre correctly rejects as undecodable map tiles.
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: 'IHDR' | 'IDAT' | 'IEND', data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function createMockMapTile(): Buffer {
  const width = 256, height = 256;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 6; // RGBA
  header[10] = 0; header[11] = 0; header[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0; // PNG filter: None
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      const isRoad = (x % 64 < 2) || (y % 64 < 2) || (Math.abs(((x + y) % 128) - 64) < 1);
      raw[pixel] = isRoad ? 39 : 8;
      raw[pixel + 1] = isRoad ? 60 : 20;
      raw[pixel + 2] = isRoad ? 73 : 30;
      raw[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const TILE_MOCK_PNG = createMockMapTile();

async function openWeatherStudio(page: Page, status: 'AVAILABLE' | 'PARTIAL', options: { primaryTilesFail?: boolean; primaryTilesDelayMs?: number; mapRendererUnavailable?: boolean } = {}) {
  await page.addInitScript((rendererUnavailable) => {
    localStorage.setItem('sonalit-auth', JSON.stringify({
      state: { user: { id: 'weather-e2e-user', name: 'Weather QA', email: 'weather-qa@sonalit.test', role: 'admin', org_id: 'weather-e2e-org' } },
      version: 0,
    }));
    if (rendererUnavailable) {
      const canvasPrototype = HTMLCanvasElement.prototype as unknown as {
        getContext: (contextId: string, ...args: unknown[]) => unknown;
      };
      const originalGetContext = canvasPrototype.getContext;
      canvasPrototype.getContext = function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
        if (['webgl', 'webgl2', 'experimental-webgl'].includes(contextId)) return null;
        return originalGetContext.apply(this, [contextId, ...args]);
      };
    }
  }, options.mapRendererUnavailable ?? false);
  await page.route(url => url.toString().includes('/spatial/live-events'), route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: fixture(status) }),
  }));
  // Deterministic primary/fallback tile behavior exercises MapLibre's real error path.
  await page.route('https://services.arcgisonline.com/**', async route => {
    if (options.primaryTilesDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.primaryTilesDelayMs));
    }
    try {
      if (options.primaryTilesFail) {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Simulated primary tile outage' });
      } else {
        await route.fulfill({ status: 200, contentType: 'image/png', body: TILE_MOCK_PNG });
      }
    } catch {
      // MapLibre may cancel the deliberately delayed primary request after falling back.
      if (!options.primaryTilesDelayMs) throw new Error('Could not fulfill test map tile request.');
    }
  });
  await page.route('https://basemaps.cartocdn.com/**', route => route.fulfill({
    status: 200, contentType: 'image/png',
    body: TILE_MOCK_PNG,
  }));
  await page.goto('/weather-studio');
  await expect(page.getByRole('heading', { name: /weather studio/i })).toBeVisible();
  if (!options.mapRendererUnavailable) {
    await expect(page.getByRole('button', { name: /Inspect CLEAR \/ MOSTLY CLEAR: Weather Studio test forecast/i })).toBeVisible({ timeout: 15000 });
  }
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

  test('keeps source-backed warnings available when the map renderer cannot initialise', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE', { mapRendererUnavailable: true });
    await expect(page.getByText('Map unavailable', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Kenya · Official alerts' })).toBeVisible();
    await expect(page.getByText('Test-only severe rainfall warning', { exact: true })).toBeVisible();
    await expect(page.locator('.wx-coverage-state')).toHaveAttribute('data-state', 'available');
    await expect(page.getByRole('button', { name: /KMD Alerts/i })).toBeDisabled();
  });

  test('maps verified CAP warning geometry and exposes an independent on/off control', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE');
    const warningLayer = page.getByRole('button', { name: /KMD Alerts/i });
    await expect(warningLayer).toBeEnabled();
    await expect(warningLayer).toHaveAttribute('aria-pressed', 'true');
    await expect(warningLayer.locator('i')).toHaveText('1');
    await expect(page.getByText('KMD WARNING AREA', { exact: true })).toBeVisible();
    await warningLayer.click();
    await expect(warningLayer).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('KMD WARNING AREA', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Kenya · Official alerts' })).toBeVisible();
  });

  test('forecast point inspection, layer toggling and hourly playback work', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE');
    await page.getByRole('button', { name: /Inspect CLEAR \/ MOSTLY CLEAR: Weather Studio test forecast/i }).click();
    await expect(page.getByRole('heading', { name: 'CLEAR / MOSTLY CLEAR' })).toBeVisible();
    await expect(page.getByText('25°C', { exact: true })).toBeVisible();

    const windFlow = page.getByRole('button', { name: /wind flow/i });
    await expect(windFlow).toBeEnabled();
    await expect(page.locator('.wx-field-label')).toHaveCount(0);
    await windFlow.click();
    await expect(windFlow).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.wx-field-label')).toBeVisible();
    await windFlow.click();
    await expect(windFlow).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.wx-field-label')).toHaveCount(0);

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
    const mapProviderSize = Number.parseFloat(await page.locator('.wx-map-provider').evaluate(el => getComputedStyle(el).fontSize));
    expect(mapProviderSize).toBeGreaterThanOrEqual(9);
    const cardTitles = await page.locator('.wx-right-column .wx-card-heading h2').allTextContents();
    expect(cardTitles[0]).toContain('Kenya · Official alerts');
  });


  test('falls back to independent cartography when primary map tiles fail', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE', { primaryTilesFail: true });
    await expect(page.locator('.wx-map-provider')).toHaveAttribute('data-provider', 'fallback', { timeout: 15000 });
    await expect(page.locator('.wx-map-provider')).toContainText('RESILIENT BASE');
    await expect(page.getByRole('button', { name: /Inspect CLEAR \/ MOSTLY CLEAR: Weather Studio test forecast/i })).toBeVisible();
  });

  test('keeps map tile activity visible until delayed tiles have reached idle', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE', { primaryTilesDelayMs: 1600 });
    await expect(page.locator('.wx-tile-sync')).toContainText('LOADING MAP TILES', { timeout: 10000 });
    await expect(page.locator('.wx-tile-sync')).toHaveCount(0, { timeout: 10000 });
  });

  test('switches to independent cartography when primary tiles do not reach idle', async ({ page }) => {
    await openWeatherStudio(page, 'AVAILABLE', { primaryTilesDelayMs: 9000 });
    await expect(page.locator('.wx-map-provider')).toHaveAttribute('data-provider', 'fallback', { timeout: 15000 });
    await expect(page.locator('.wx-map-provider')).toContainText('RESILIENT BASE');
    await expect(page.locator('.wx-tile-sync')).toHaveCount(0, { timeout: 10000 });
  });

  test('uses shipped display fonts and keeps mobile operational labels readable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWeatherStudio(page, 'AVAILABLE');
    const typography = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing typography target: ${selector}`);
        const style = getComputedStyle(element);
        return { size: Number.parseFloat(style.fontSize), family: style.fontFamily };
      };
      return {
        heading: read('.wx-brand-copy h1'),
        layerLabel: read('.wx-layer-button__copy > span'),
        layerCaption: read('.wx-layer-button__copy > small'),
        mapProvider: read('.wx-map-provider'),
      };
    });
    expect(typography.heading.family.toLowerCase()).toContain('sora');
    expect(typography.layerLabel.size).toBeGreaterThanOrEqual(11);
    expect(typography.layerCaption.size).toBeGreaterThanOrEqual(9);
    expect(typography.mapProvider.size).toBeGreaterThanOrEqual(9);
  });

  test('switches to a map-first tablet layout before the three-zone desk gets cramped', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openWeatherStudio(page, 'AVAILABLE');
    const geometry = await page.evaluate(() => {
      const map = document.querySelector('.wx-map-panel')?.getBoundingClientRect();
      const layers = document.querySelector('.wx-layer-rail')?.getBoundingClientRect();
      const right = document.querySelector('.wx-right-column')?.getBoundingClientRect();
      return {
        map: { top: map?.top ?? 0, width: map?.width ?? 0 },
        layersTop: layers?.top ?? 0,
        rightTop: right?.top ?? 0,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(geometry.map.width).toBeGreaterThanOrEqual(900);
    expect(geometry.layersTop).toBeGreaterThan(geometry.map.top);
    expect(geometry.rightTop).toBeGreaterThan(geometry.layersTop);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
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


  test('keeps the map key below the map imagery and source lineage collapsed until requested', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openWeatherStudio(page, 'AVAILABLE');
    const rectangles = await page.evaluate(() => {
      const map = document.querySelector('.wx-map-canvas')?.getBoundingClientRect();
      const key = document.querySelector('.wx-map-legend')?.getBoundingClientRect();
      return { mapBottom: map?.bottom ?? 0, keyTop: key?.top ?? 0 };
    });
    expect(rectangles.keyTop).toBeGreaterThanOrEqual(rectangles.mapBottom - 1);
    const sourceDisclosure = page.locator('.wx-source-card');
    await expect(sourceDisclosure).not.toHaveAttribute('open', '');
    await sourceDisclosure.locator('summary').click();
    await expect(sourceDisclosure).toHaveAttribute('open', '');
    await expect(sourceDisclosure.getByText('USGS ComCat')).toBeVisible();
  });


  test('uses a dedicated layer rail beside the live map and preserves map controls', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openWeatherStudio(page, 'AVAILABLE');
    await expect(page.locator('.wx-layer-rail')).toBeVisible();
    await expect(page.locator('.wx-map-panel')).toBeVisible();
    await expect(page.locator('.wx-right-column')).toBeVisible();
    const layout = await page.evaluate(() => {
      const left = document.querySelector('.wx-layer-rail')?.getBoundingClientRect();
      const map = document.querySelector('.wx-map-panel')?.getBoundingClientRect();
      const right = document.querySelector('.wx-right-column')?.getBoundingClientRect();
      return { leftRight: left?.right ?? 0, mapLeft: map?.left ?? 0, mapRight: map?.right ?? 0, rightLeft: right?.left ?? 0 };
    });
    expect(layout.leftRight).toBeLessThan(layout.mapLeft);
    expect(layout.mapRight).toBeLessThan(layout.rightLeft);
    await expect(page.getByRole('button', { name: /weather models/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /wind flow/i })).toBeEnabled();
  });

});
