/**
 * Portal UX — visual and interaction quality tests (portal-build)
 *
 * Verifies: design system tokens applied, health strip renders,
 * pipeline cards show route ribbon, navigation between pages works,
 * custody ledger chain indicator present.
 */
import { expect, test } from '@playwright/test';

const CONVOY_X = 'convoy-x-uuid-0000-0000-000000000001';

function stubShipments(page: import('@playwright/test').Page) {
  return page.route(
    url => url.toString().includes('/api/v1/portal/shipments'),
    route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            convoy_id: CONVOY_X,
            reference: 'SHP-PORTAL-001',
            status: 'in_transit',
            origin: 'Durban',
            destination: 'Johannesburg',
            eta: new Date(Date.now() + 4 * 3600_000).toISOString(),
            last_ping_at: new Date(Date.now() - 120_000).toISOString(),
            progress_pct: 65,
            exception_count: 0,
            seal_status: 'intact',
            current_location: { lat: -29.8, lng: 31.0 },
          },
          {
            convoy_id: 'convoy-completed',
            reference: 'SHP-PORTAL-002',
            status: 'completed',
            origin: 'Cape Town',
            destination: 'Pretoria',
            eta: null,
            last_ping_at: null,
            progress_pct: 100,
            exception_count: 1,
            seal_status: 'intact',
            current_location: null,
          },
        ],
      }),
    }),
  );
}

test.describe('Portal UX — Command Center', () => {

  test('dashboard shows health strip stat cards', async ({ page }) => {
    await stubShipments(page);
    await page.goto('/portal/dashboard');
    await expect(page.getByText('Active Convoys')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Total Shipments')).toBeVisible({ timeout: 4000 });
  });

  test('pipeline cards show reference and route', async ({ page }) => {
    await stubShipments(page);
    await page.goto('/portal/dashboard');
    await expect(page.getByText('SHP-PORTAL-001')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/Durban/)).toBeVisible({ timeout: 4000 });
    await expect(page.getByText(/Johannesburg/)).toBeVisible({ timeout: 4000 });
  });

  test('completed tab filters to completed shipments', async ({ page }) => {
    await stubShipments(page);
    await page.goto('/portal/dashboard');
    await page.getByRole('button', { name: 'Completed' }).click();
    await expect(page.getByText('SHP-PORTAL-002')).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('SHP-PORTAL-001')).not.toBeVisible({ timeout: 3000 });
  });

  test('search filters by reference', async ({ page }) => {
    await stubShipments(page);
    await page.goto('/portal/dashboard');
    await page.getByRole('button', { name: 'All' }).click();
    await page.getByPlaceholder(/Search reference/).fill('002');
    await expect(page.getByText('SHP-PORTAL-002')).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('SHP-PORTAL-001')).not.toBeVisible({ timeout: 3000 });
  });

  test('POD link only shown for completed shipments', async ({ page }) => {
    await stubShipments(page);
    await page.goto('/portal/dashboard');
    // Check completed tab has POD link
    await page.getByRole('button', { name: 'Completed' }).click();
    await expect(page.getByText('POD')).toBeVisible({ timeout: 6000 });
    // Switch to active - POD should not appear
    await page.getByRole('button', { name: 'Active' }).click();
    await expect(page.getByText('POD')).not.toBeVisible({ timeout: 3000 });
  });

});

test.describe('Portal UX — Track page', () => {

  test('track page shows ETA ribbon and deep-track header', async ({ page }) => {
    await page.route(
      url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/overview`),
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            convoy_id: CONVOY_X,
            org_id: 'org-1',
            reference: 'CVY-TRACK-001',
            status: 'in_transit',
            origin: 'Durban',
            destination: 'Johannesburg',
            departed_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
            estimated_arrival_at: new Date(Date.now() + 4 * 3600_000).toISOString(),
            arrived_at: null,
            progress_pct: 33,
            eta_confidence_low: null,
            eta_confidence_high: null,
            vehicles: [
              {
                vehicle_id: 'v1',
                registration: 'NDE 123 GP',
                make: 'Volvo', model: 'FH', type: 'truck',
                driver_name: 'A. Mkhize',
                current_lat: -29.5, current_lng: 30.5,
                speed_kmh: 80, heading_deg: 45,
                last_ping_at: new Date(Date.now() - 60_000).toISOString(),
                carries_my_cargo: true,
              },
            ],
            escorts: [],
            coload_count: 0,
            exception_count: 0,
            seal_status: 'intact',
            custody_events: [],
            waypoints: [],
          },
        }),
      }),
    );
    await page.goto(`/portal/convoy/${CONVOY_X}/track`);
    await expect(page.getByText('Estimated Arrival')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Deep Track')).toBeVisible({ timeout: 4000 });
  });

  test('vehicles & crew card shows carrying-my-cargo label', async ({ page }) => {
    await page.route(
      url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/overview`),
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            convoy_id: CONVOY_X,
            org_id: 'org-1',
            reference: 'CVY-001',
            status: 'in_transit',
            origin: 'A', destination: 'B',
            departed_at: null, estimated_arrival_at: null, arrived_at: null,
            progress_pct: null, eta_confidence_low: null, eta_confidence_high: null,
            vehicles: [{
              vehicle_id: 'v1', registration: 'ABC 123 GP',
              make: null, model: null, type: null,
              driver_name: 'T. Nkosi',
              current_lat: null, current_lng: null,
              speed_kmh: null, heading_deg: null, last_ping_at: null,
              carries_my_cargo: true,
            }],
            escorts: [],
            coload_count: 2,
            exception_count: 0,
            seal_status: null,
            custody_events: [],
            waypoints: [],
          },
        }),
      }),
    );
    await page.goto(`/portal/convoy/${CONVOY_X}/track`);
    await expect(page.getByText('YOUR CARGO')).toBeVisible({ timeout: 8000 });
  });

});

test.describe('Portal UX — Custody Ledger', () => {

  test('empty custody shows helpful empty state', async ({ page }) => {
    page.route(
      url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/custody`),
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { chain_valid: true, event_count: 0 } }),
      }),
    );
    await page.goto(`/portal/convoy/${CONVOY_X}/custody`);
    await expect(page.getByText(/No custody events/i)).toBeVisible({ timeout: 8000 });
  });

  test('broken chain shows chain-broken indicator', async ({ page }) => {
    page.route(
      url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/custody`),
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              event_id: 'ev-1', seq: 0, kind: 'departure',
              location: 'Port A', timestamp: new Date().toISOString(),
              officer: null, seal_intact: true,
              hash: 'a'.repeat(64), prev_hash: null, verified: true,
            },
            {
              event_id: 'ev-2', seq: 1, kind: 'checkpoint',
              location: 'Stop B', timestamp: new Date().toISOString(),
              officer: null, seal_intact: true,
              hash: 'b'.repeat(64),
              prev_hash: 'c'.repeat(64), // WRONG — should be 'a'.repeat(64)
              verified: false,
            },
          ],
          meta: { chain_valid: false, event_count: 2 },
        }),
      }),
    );
    await page.goto(`/portal/convoy/${CONVOY_X}/custody`);
    await expect(page.getByText(/Chain Broken/i)).toBeVisible({ timeout: 8000 });
  });

});
