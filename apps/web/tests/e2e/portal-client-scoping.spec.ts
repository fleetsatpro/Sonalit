/**
 * Portal Client Scoping — non-negotiable security gate (V3-F8)
 *
 * Verifies that a cargo client sees only linked convoys and that the backend
 * guard is surfaced consistently in the client portal.
 */
import { expect, test } from '@playwright/test';

const CONVOY_X = 'convoy-x-uuid-0000-0000-000000000001';
const CONVOY_Y = 'convoy-y-uuid-0000-0000-000000000002';

async function stubClientSession(page: import('@playwright/test').Page) {
  await page.route(url => url.toString().includes('/api/v1/portal/shipments'), route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ convoy_id: CONVOY_X, reference: 'SHP-001', status: 'in_transit', origin: 'Lagos', destination: 'Abuja', eta: null, last_ping_at: null, progress_pct: null, exception_count: 0, seal_status: 'intact', current_location: null }],
      }),
    }),
  );
}

function stubConvoyX(page: import('@playwright/test').Page, endpoint: string) {
  page.route(
    url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/${endpoint}`),
    route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );
}

function stubConvoyY403(page: import('@playwright/test').Page, endpoint: string) {
  return page.route(
    url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_Y}/${endpoint}`),
    route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Not authorised for this convoy' }) }),
  );
}

async function stubUnauthenticated(page: import('@playwright/test').Page) {
  await page.route(url => url.toString().includes('/api/v1/portal/'), route =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Not authenticated' }) }),
  );
}

test.describe('§00 Portal Client Scoping', () => {
  test('unauthenticated client is redirected to /portal/login from dashboard', async ({ page }) => {
    await stubUnauthenticated(page);
    await page.goto('/portal/dashboard');
    await expect(page).toHaveURL(/\/portal\/login/, { timeout: 8000 });
  });

  test('unauthenticated client is redirected from manifest page', async ({ page }) => {
    await stubUnauthenticated(page);
    await page.goto(`/portal/convoy/${CONVOY_X}/manifest`);
    await expect(page).toHaveURL(/\/portal\/login/, { timeout: 8000 });
  });

  test('unauthenticated client is redirected from POD page', async ({ page }) => {
    await stubUnauthenticated(page);
    await page.goto(`/portal/convoy/${CONVOY_X}/pod`);
    await expect(page).toHaveURL(/\/portal\/login/, { timeout: 8000 });
  });

  test('403 on unlinked convoy manifest is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'manifest');
    await page.goto(`/portal/convoy/${CONVOY_Y}/manifest`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('403 on unlinked convoy POD is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'pod');
    await page.goto(`/portal/convoy/${CONVOY_Y}/pod`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('403 on unlinked convoy exceptions is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'exceptions');
    await page.goto(`/portal/convoy/${CONVOY_Y}/exceptions`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('403 on unlinked convoy documents is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'documents');
    await page.goto(`/portal/convoy/${CONVOY_Y}/documents`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('403 on unlinked convoy sensors is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'sensors');
    await page.goto(`/portal/convoy/${CONVOY_Y}/sensors`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('403 on unlinked convoy replay is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'replay');
    await page.goto(`/portal/convoy/${CONVOY_Y}/replay`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('linked convoy (X) manifest loads successfully', async ({ page }) => {
    await stubClientSession(page);
    stubConvoyX(page, 'manifest');
    await page.goto(`/portal/convoy/${CONVOY_X}/manifest`);
    await expect(page.locator('text=/not authorised|403/i')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=/SONALIT/i').first()).toBeVisible({ timeout: 8000 });
  });

  test('linked convoy (X) sensors loads successfully', async ({ page }) => {
    await stubClientSession(page);
    stubConvoyX(page, 'sensors');
    await page.goto(`/portal/convoy/${CONVOY_X}/sensors`);
    await expect(page.locator('text=/not authorised|403/i')).not.toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=/SONALIT/i').first()).toBeVisible({ timeout: 8000 });
  });

  test('dashboard only shows shipments returned by the API', async ({ page }) => {
    await stubClientSession(page);
    await page.goto('/portal/dashboard');
    await expect(page.getByText('SHP-001')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(CONVOY_Y)).not.toBeVisible({ timeout: 4000 });
  });

  test('403 on unlinked convoy overview (track page) is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'overview');
    await page.goto(`/portal/convoy/${CONVOY_Y}/track`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('403 on unlinked convoy overview (convoy page) is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'overview');
    await page.goto(`/portal/convoy/${CONVOY_Y}/convoy`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('403 on unlinked convoy custody is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'custody');
    await page.goto(`/portal/convoy/${CONVOY_Y}/custody`);
    await expect(page.locator('text=/not authorised|403|failed/i')).toBeVisible({ timeout: 8000 });
  });

  test('custody page shows chain-valid banner when chain is intact', async ({ page }) => {
    page.route(
      url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/custody`),
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ event_id: 'ev-001', seq: 0, kind: 'departure', location: 'Lagos Port', timestamp: new Date().toISOString(), officer: 'J. Adeyemi', seal_intact: true, hash: 'a'.repeat(64), prev_hash: null, verified: true }],
          meta: { chain_valid: true, event_count: 1 },
        }),
      }),
    );
    await page.goto(`/portal/convoy/${CONVOY_X}/custody`);
    await expect(page.locator('text=/Chain Valid/i')).toBeVisible({ timeout: 8000 });
  });

  test('co-load count is visible without exposing a second consignment identity', async ({ page }) => {
    page.route(
      url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/overview`),
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            convoy_id: CONVOY_X,
            org_id: 'org-001',
            reference: 'CVY-001',
            status: 'in_transit',
            origin: 'Lagos',
            destination: 'Abuja',
            departed_at: null,
            estimated_arrival_at: null,
            arrived_at: null,
            progress_pct: 42,
            eta_confidence_low: null,
            eta_confidence_high: null,
            vehicles: [],
            escorts: [],
            coload_count: 3,
            exception_count: 0,
            seal_status: 'intact',
            custody_events: [],
            waypoints: [],
          },
        }),
      }),
    );
    await page.goto(`/portal/convoy/${CONVOY_X}/convoy`);
    await expect(page.locator('text=/3 other secured consignment/i')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('OTHER-CLIENT-SECRET', { exact: true })).not.toBeVisible({ timeout: 2000 });
    await expect(page.getByText('OTHER-CONSIGNMENT-SECRET', { exact: true })).not.toBeVisible({ timeout: 2000 });
  });

  test('403 on unlinked convoy security status is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'security');
    stubConvoyY403(page, 'incidents');
    await page.goto(`/portal/convoy/${CONVOY_Y}/security`);
    await expect(page.locator('text=/not authorised|403|failed/i').first()).toBeVisible({ timeout: 8000 });
  });

  test('403 on unlinked convoy incidents is surfaced as error', async ({ page }) => {
    stubConvoyY403(page, 'security');
    stubConvoyY403(page, 'incidents');
    await page.goto(`/portal/convoy/${CONVOY_Y}/security`);
    await expect(page.locator('text=/not authorised|403|failed/i').first()).toBeVisible({ timeout: 8000 });
  });
});
