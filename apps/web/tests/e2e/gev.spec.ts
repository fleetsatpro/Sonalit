import { test, expect } from '@playwright/test';

async function seedAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(({ user }: { user: object }) => {
    localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
  }, { user: { id: 'user-gev', name: 'GEV Operator', email: 'gev@test.io', role: 'admin', org_id: 'org-gev' } });
}

test.describe('God\'s Eye View visual shell', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);

    await page.route(url => url.toString().includes('/api/v1/realtime/token'), route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'fake.payload.sig' }),
      })
    );

    await page.route(url => url.toString().includes('/api/v1/dashboard/vehicles'), route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [
          { id: 'veh-1', registration: 'GEV-001', convoy_id: null, status: 'active', speed_kmh: 62, last_ping_at: new Date().toISOString() },
        ] }),
      })
    );

    await page.route(url => url.toString().includes('/api/v1/dashboard/convoys'), route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    );

    await page.route(url => url.toString().includes('/api/v1/gps/track'), route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { device_id: 'dev-1', vehicle_id: 'veh-1', name: 'GEV-001', lat: -1.2921, lng: 36.8219, speed: 62, heading: 90, timestamp: new Date().toISOString() },
        ]),
      })
    );

    await page.route(url => url.toString().includes('/api/v1/riskzones'), route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    );

    await page.route(url => url.toString().includes('/api/v1/spatial/world-context'), route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            generatedAt: new Date().toISOString(),
            entities: [],
            warnings: [],
            providerHealth: {},
          },
        }),
      })
    );
  });

  test('renders premium GEV command chrome and 2D/3D handoff controls', async ({ page }) => {
    await page.goto('/gev');
    await expect(page.locator('.gev-shell')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.gev-topbar')).toBeVisible();
    await expect(page.locator('.gev-mode-switch')).toBeVisible();
    await expect(page.getByRole('button', { name: /WORLD 2D/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /XD 3D \/ 8D/i })).toBeVisible();
  });
});
