/**
 * Portal Client Scoping — non-negotiable security gate (V3-F8)
 *
 * §00 contract: A cargo client MUST see ONLY the convoys/shipments they are
 * explicitly linked to. Every portal data endpoint must reject requests for
 * an unlinked convoy with 403, even when the client holds a valid JWT for the
 * same org.
 *
 * Tests verify that:
 *  1. The frontend correctly redirects / shows an error on 401 (expired/missing JWT)
 *  2. The frontend correctly surfaces the 403 error when the backend rejects
 *     a cross-convoy request
 *  3. Linked convoys resolve successfully (200)
 *  4. The manifest, POD, exceptions, documents, sensors, replay pages all
 *     enforce the scoping guard
 */
import { expect, test } from '@playwright/test';

const CONVOY_X = 'convoy-x-uuid-0000-0000-000000000001';
const CONVOY_Y = 'convoy-y-uuid-0000-0000-000000000002'; // client is NOT linked to this

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Stub a valid client session (client linked to convoy-x only) */
async function stubClientSession(page: import('@playwright/test').Page) {
  // The httpOnly cookie cannot be set from JS; instead we intercept /portal/shipments
  // to return convoy-x and stub downstream convoy endpoints accordingly.
  await page.route(url => url.toString().includes('/api/v1/portal/shipments'), route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{
          convoy_id: CONVOY_X,
          reference: 'SHP-001',
          status: 'in_transit',
          origin: 'Lagos',
          destination: 'Abuja',
          eta: null,
          last_ping_at: null,
          progress_pct: null,
          exception_count: 0,
          seal_status: 'intact',
          current_location: null,
        }],
      }),
    }),
  );
}

/** Stub convoy-x endpoints as successful (empty data) */
function stubConvoyX(page: import('@playwright/test').Page, endpoint: string) {
  page.route(
    url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/${endpoint}`),
    route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );
}

/** Stub convoy-y endpoint as 403 (server-enforced §00) */
function stubConvoyY403(page: import('@playwright/test').Page, endpoint: string) {
  page.route(
    url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_Y}/${endpoint}`),
    route => route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Not authorised for this convoy' }),
    }),
  );
}

/** Stub ALL portal API as 401 (unauthenticated) */
async function stubUnauthenticated(page: import('@playwright/test').Page) {
  await page.route(url => url.toString().includes('/api/v1/portal/'), route =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Not authenticated' }) }),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('§00 Portal Client Scoping', () => {

  test('unauthenticated client is redirected to /portal/login from dashboard', async ({ page }) => {
    await stubUnauthenticated(page);
    await page.goto('/portal/dashboard');
    // Dashboard fetches /portal/shipments → 401 → redirects to login
    await expect(page).toHaveURL(/\/portal\/login/, { timeout: 8000 });
  });

  test('unauthenticated client is redirected to /portal/login from manifest page', async ({ page }) => {
    await stubUnauthenticated(page);
    await page.goto(`/portal/convoy/${CONVOY_X}/manifest`);
    await expect(page).toHaveURL(/\/portal\/login/, { timeout: 8000 });
  });

  test('unauthenticated client is redirected from POD page', async ({ page }) => {
    await stubUnauthenticated(page);
    await page.goto(`/portal/convoy/${CONVOY_X}/pod`);
    await expect(page).toHaveURL(/\/portal\/login/, { timeout: 8000 });
  });

  test('403 on unlinked convoy manifest is surfaced as error (not silent data leak)', async ({ page }) => {
    stubConvoyY403(page, 'manifest');
    await page.goto(`/portal/convoy/${CONVOY_Y}/manifest`);
    // Expect an error message to be visible — not an empty data table
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
    // Should NOT show a 403 error — page renders (may show empty state)
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

  test('dashboard only shows shipments returned by the API (no cross-convoy leak)', async ({ page }) => {
    await stubClientSession(page);
    await page.goto('/portal/dashboard');
    await expect(page.getByText('SHP-001')).toBeVisible({ timeout: 8000 });
    // convoy-y reference should never appear
    await expect(page.getByText(CONVOY_Y)).not.toBeVisible({ timeout: 4000 });
  });
});
