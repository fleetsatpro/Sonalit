import { test, expect } from '@playwright/test';

const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER = {
  id: 'user-gev-001',
  name: 'Spatial Admin',
  email: 'spatial@example.test',
  role: 'admin',
  org_id: ORG_ID,
};

const CAMERA = {
  id: 'camera-london-001',
  entityType: 'camera',
  source: 'test-live-catalog',
  sourceReference: 'camera-london-001',
  latitude: 35.5,
  longitude: 1.2,
  observedAt: new Date().toISOString(),
  observationConfidence: 0.92,
  status: 'LIVE',
  attributes: { name: 'AOI Camera 01' },
  quality: { state: 'ok', freshnessClass: 'LIVE', reason: 'test catalog response' },
  provenance: { sourceName: 'Test live catalog', observationType: 'public_camera' },
};

async function seedAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(({ user }: { user: object }) => {
    localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
  }, { user: USER });
}

async function mockGevRoutes(page: import('@playwright/test').Page) {
  await page.route(url => url.toString().includes('/api/v1/dashboard/vehicles'), route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  );
  await page.route(url => url.toString().includes('/api/v1/dashboard/convoys'), route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  );
  await page.route(url => url.toString().includes('/api/v1/gps/track'), route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  );
  await page.route(url => url.toString().includes('/api/v1/realtime/token'), route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'test-realtime-token' }),
    })
  );
  await page.route(url => url.toString().includes('/api/v1/riskzones'), route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  );
  await page.route(url => url.toString().includes('/api/v1/spatial/world-context'), route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          generatedAt: new Date().toISOString(),
          entities: [{
            id: 'aircraft-test-001',
            entityType: 'aircraft',
            source: 'test-open-source',
            latitude: 35.51,
            longitude: 1.21,
            telemetryLive: true,
            attributes: { callsign: 'TEST-AIR-01' },
            quality: { state: 'ok', freshnessClass: 'LIVE' },
          }],
          coverage: {
            layersRequested: ['aircraft','weather','maritime','traffic','hazards','security','infrastructure','incidents','alerts','cameras','satellites'],
            layersSucceeded: ['aircraft','weather','maritime','traffic','hazards','security','infrastructure','incidents','alerts','cameras','satellites'],
            layersPartial: [],
            layersUnavailable: [],
          },
        },
      }),
    })
  );
  await page.route(url => url.toString().includes('/api/v1/cctv/cameras'), route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [CAMERA],
        health: { status: 'healthy' },
        coverage: { state: 'covered' },
        warnings: [],
      }),
    })
  );
}

test.describe('God\'s Eye View — interactive spatial surface', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await mockGevRoutes(page);
  });

  test('switches between 2D and immersive 3D without losing the GEV shell', async ({ page }) => {
    await page.goto('/gev');

    await expect(page.getByText("GOD'S EYE VIEW").first()).toBeVisible({ timeout: 10000 });
    const immersive = page.getByRole('button', { name: /Immersive 3D/i });
    const world2d = page.getByRole('button', { name: /World 2D/i });

    await expect(immersive).toHaveAttribute('aria-pressed', 'true');
    await world2d.click();
    await expect(world2d).toHaveAttribute('aria-pressed', 'true');
    await immersive.click();
    await expect(immersive).toHaveAttribute('aria-pressed', 'true');
  });

  test('can focus every World Context layer without hiding the selected lane', async ({ page }) => {
    await page.goto('/gev');

    const layers = [
      'Aircraft',
      'Weather',
      'Maritime',
      'Traffic',
      'Hazards',
      'Security',
      'Infrastructure',
      'Incidents',
      'Alerts',
      'Cameras',
      'Satellites',
    ];

    for (const layer of layers) {
      const button = page.getByRole('button', { name: layer }).first();
      await button.click();
      await expect(page.locator('.gev-aoi-title')).toHaveText(layer);
      await expect(button).toHaveAttribute('aria-disabled', 'false');
    }
  });

  test('selects CCTV as the active intelligence lane and lists AOI cameras', async ({ page }) => {
    await page.goto('/gev');

    const cameras = page.getByRole('button', { name: 'Cameras' }).first();
    await cameras.click();

    await expect(page.getByText('Active intelligence lane').first()).toBeVisible();
    await expect(page.getByText('Cameras').first()).toBeVisible();
    await expect(page.getByText('CAMERAS IN CURRENT AOI')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('AOI Camera 01')).toBeVisible({ timeout: 10000 });
  });

  test('selecting an AOI camera opens source-backed camera intelligence without synthetic media', async ({ page }) => {
    await page.goto('/gev');

    await page.getByRole('button', { name: 'Cameras' }).first().click();
    await expect(page.getByText('AOI Camera 01')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /AOI Camera 01/i }).click();
    await expect(page.getByText('Camera geometry')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('NO FRAME LOADED')).toBeVisible();
    await expect(page.getByText('SONALIT CCTV — SYNTHETIC')).not.toBeVisible();
  });
});
