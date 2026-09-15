import { expect, test } from '@playwright/test';

const CONVOYS = [
  { id: 'conv-1', reference: 'CONVOY-001', status: 'active', origin: 'Lagos', destination: 'Abuja', estimated_arrival_at: new Date(Date.now() + 4 * 3600_000).toISOString(), seal_intact: true },
];

const CLIENTS = [
  { id: 'client-1', email: 'client@test.io', name: 'ACME Logistics', company: 'ACME', phone: null, last_login_at: null, created_at: '2026-05-29T08:00:00.000Z', linked_convoys: 1, active_convoys: 1, completed_convoys: 0 },
];

const TRACK_OVERVIEW = {
  convoy_id: 'conv-1',
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
  vehicles: [{
    vehicle_id: 'v1', registration: 'NDE 123 GP', make: 'Volvo', model: 'FH', type: 'truck',
    driver_name: 'A. Mkhize', current_lat: -29.5, current_lng: 30.5, speed_kmh: 80,
    heading_deg: 45, last_ping_at: new Date(Date.now() - 60_000).toISOString(), carries_my_cargo: true,
  }],
  escorts: [],
  coload_count: 0,
  exception_count: 0,
  seal_status: 'intact',
  custody_events: [],
  waypoints: [],
};

const TRACK_VEHICLES = [{
  vehicle_id: 'v1', registration: 'NDE 123 GP', make: 'Volvo', model: 'FH', type: 'truck',
  driver_name: 'A. Mkhize', current_lat: -29.5, current_lng: 30.5, speed_kmh: 80,
  heading_deg: 45, last_ping_at: new Date(Date.now() - 60_000).toISOString(), carries_my_cargo: true,
}];

async function seedAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(({ user }: { user: object }) => {
    localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
  }, { user: { id: 'user-1', name: 'Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' } });
}

test.describe('Cargo Owner Control Tower', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await page.route(url => url.toString().includes('/api/v1/realtime/token'), route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'fake.payload.sig' }) }));
    await page.route(url => url.toString().includes('/api/v1/convoys'), route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CONVOYS, meta: { total: 1, limit: 200, offset: 0 } }) }));
    await page.route(url => url.toString().includes('/api/v1/portal/clients'), route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CLIENTS }) }));
  });

  test('renders control tower', async ({ page }) => {
    await page.goto('/cargo-portal');
    await expect(page.getByRole('heading', { name: /Cargo Control Tower/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('ACTIVE MOVEMENTS')).toBeVisible({ timeout: 4000 });
    await expect(page.getByText('Live movement atlas')).toBeVisible({ timeout: 4000 });
  });

  test('shows real convoy and available shipment controls', async ({ page }) => {
    await page.goto('/cargo-portal');
    await expect(page.getByText('CONVOY-001')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Lagos')).toBeVisible({ timeout: 4000 });
    await expect(page.getByText('Shipment workspaces')).toBeVisible({ timeout: 4000 });
  });

  test('client 360 is real-data backed and reflects active workspace count', async ({ page }) => {
    await page.goto('/cargo-portal');
    await page.getByRole('button', { name: 'Client 360', exact: true }).first().click();
    await expect(page.getByText('ACME Logistics')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Active')).toBeVisible({ timeout: 4000 });
  });
});

test.describe('Portal UX — Dashboard', () => {
  test('customer dashboard renders real cargo map surface', async ({ page }) => {
    await page.route(url => url.toString().includes('/api/v1/portal/shipments'), route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
        { convoy_id: 'conv-1', reference: 'SHP-PORTAL-001', status: 'in_transit', origin: 'Durban', destination: 'Johannesburg', eta: new Date(Date.now() + 3600_000).toISOString(), last_ping_at: new Date(Date.now() - 60_000).toISOString(), progress_pct: 65, exception_count: 0, seal_status: 'intact', current_location: { lat: -29.8, lng: 31.0 } },
      ] }) }));
    await page.goto('/portal/dashboard');
    await expect(page.getByText('Live shipments', { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Cargo positions', { exact: true })).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('SHP-PORTAL-001', { exact: true })).toBeVisible({ timeout: 6000 });
  });
});

test.describe('Portal UX — Track page', () => {
  test('track page shows live telemetry workspace', async ({ page }) => {
    await page.route(url => url.toString().includes('/api/v1/portal/convoy/conv-1/overview'), route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: TRACK_OVERVIEW }) }));
    await page.route(url => url.toString().includes('/api/v1/portal/convoy/conv-1/vehicles'), route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: TRACK_VEHICLES }) }));
    await page.route(url => url.toString().includes('/api/v1/portal/convoy/conv-1/replay'), route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
        { vehicle_id: 'v1', lat: -29.6, lng: 30.6, timestamp: new Date(Date.now() - 120_000).toISOString(), speed: 79 },
        { vehicle_id: 'v1', lat: -29.5, lng: 30.5, timestamp: new Date(Date.now() - 60_000).toISOString(), speed: 80 },
      ] }) }));
    await page.goto('/portal/convoy/conv-1/track');
    await expect(page.getByText('CVY-TRACK-001', { exact: true })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Live tracking', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('NDE 123 GP', { exact: true })).toBeVisible({ timeout: 5000 });
  });
});
