import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type CommandFixtureOptions = {
  failSecondConvoyRefresh?: boolean;
  partialSources?: boolean;
};

const now = Date.now();
const iso = (offsetMs = 0) => new Date(now + offsetMs).toISOString();

async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sonalit-auth', JSON.stringify({
      state: {
        user: {
          id: 'user-command-centre-e2e',
          name: 'Command Centre E2E',
          email: 'command-centre-e2e@example.invalid',
          role: 'admin',
          org_id: 'org-command-centre-e2e',
        },
      },
      version: 0,
    }));
  });
}

async function stubCommandApis(page: Page, options: CommandFixtureOptions = {}) {
  let convoyRequests = 0;

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    if (path.endsWith('/realtime/token')) {
      return json({ error: 'realtime_not_available_in_command_centre_e2e' }, 503);
    }

    if (path.endsWith('/dashboard/overview')) {
      const partial = options.partialSources === true;
      return json({
        data_quality: {
          state: partial ? 'partial' : 'complete',
          critical_ready: !partial,
          kpi_ready: !partial,
          failed_sources: partial ? ['alerts'] : [],
          snapshot_at: iso(),
        },
        threat: { level: 'elevated', alerts_open: 3, incidents_active: 1 },
        kpi: {
          vehicles_live: 1,
          convoys_active: 1,
          on_time_pct: 96,
          incidents_open: 1,
          payload_tonnes: 180,
          consignments: 8,
          km_today: 340,
          guards_active: 2,
        },
        next_delivery: { convoy_id: 'convoy-e2e-001', convoy_name: 'NORTH-01', eta: iso(2 * 60 * 60_000) },
        shift_started_at: iso(-4 * 60 * 60_000),
      });
    }

    if (path.endsWith('/dashboard/convoys')) {
      convoyRequests += 1;
      if (options.failSecondConvoyRefresh && convoyRequests > 1) {
        return json({ error: 'temporary_convoy_source_failure', data: [] }, 503);
      }
      return json({
        data_quality: {
          checkpoints_ready: !options.partialSources,
          snapshot_at: iso(),
        },
        data: [{
          id: 'convoy-e2e-001',
          name: 'NORTH-01',
          status: 'in_transit',
          origin: 'Nairobi',
          destination: 'Kampala',
          eta: iso(2 * 60 * 60_000),
          truck_count: 3,
          checkpoints: options.partialSources ? [] : [
            { name: 'Naivasha', status: 'done', reached_at: iso(-30 * 60_000) },
            { name: 'Nakuru', status: 'pending', reached_at: null },
          ],
        }],
      });
    }

    if (path.endsWith('/dashboard/vehicles')) {
      return json({
        data: [{
          id: 'vehicle-e2e-001',
          registration: 'KDA 001A',
          convoy_id: 'convoy-e2e-001',
          status: 'moving',
          speed_kmh: 64,
          lat: -1.2864,
          lng: 36.8172,
          heading: 90,
          last_ping_at: iso(-60_000),
        }],
      });
    }

    if (path.endsWith('/dashboard/map')) {
      return json({
        data_quality: {
          state: options.partialSources ? 'partial' : 'complete',
          failed_sources: options.partialSources ? ['risk_zones'] : [],
          snapshot_at: iso(),
        },
        convoys: [{
          id: 'convoy-e2e-001', name: 'NORTH-01', status: 'active',
          lat: -1.2864, lng: 36.8172, heading: 90,
        }],
        vehicles: [{
          id: 'vehicle-e2e-001', registration: 'KDA 001A', status: 'moving',
          lat: -1.2864, lng: 36.8172, heading: 90, speed_kmh: 64,
        }],
        alert_zones: [],
        geofences: [],
        riskzones: [],
        devices: [],
      });
    }

    if (path.endsWith('/dashboard/timeline')) {
      return json({
        data: options.partialSources ? [] : [
          { type: 'checkpoint', label: 'Nakuru checkpoint', time: iso(90 * 60_000), convoy_id: 'convoy-e2e-001', fraction: 0.06 },
          { type: 'arrival', label: 'NORTH-01 arrival', time: iso(2 * 60 * 60_000), convoy_id: 'convoy-e2e-001', fraction: 0.08 },
          { type: 'shift', label: 'Shift changeover', time: iso(5 * 60 * 60_000), fraction: 0.21 },
        ],
        data_quality: {
          state: options.partialSources ? 'partial' : 'complete',
          failed_sources: options.partialSources ? ['arrivals', 'checkpoints'] : [],
          snapshot_at: iso(),
        },
      });
    }

    if (path.endsWith('/dashboard/alerts')) {
      return json({
        data: [
          {
            id: 'alert-e2e-critical',
            severity: 'critical',
            type: 'geofence_deviation',
            title: 'Critical perimeter deviation',
            summary: 'Vehicle departed the approved movement corridor.',
            convoy_id: 'convoy-e2e-001',
            occurred_at: iso(-4 * 60_000),
            acknowledged: false,
          },
          {
            id: 'alert-e2e-high',
            severity: 'high',
            type: 'cargo_integrity',
            title: 'High cargo integrity alert',
            summary: 'Seal inspection requires operator review.',
            priority_reason: 'Seal evidence mismatch requires inspection before this load proceeds.',
            convoy_id: 'convoy-e2e-001',
            occurred_at: iso(-8 * 60_000),
            acknowledged: false,
          },
          {
            id: 'alert-e2e-medium',
            severity: 'medium',
            type: 'speed_observation',
            title: 'Medium vehicle speed observation',
            summary: 'Speed exceeded the route advisory threshold.',
            convoy_id: 'convoy-e2e-001',
            occurred_at: iso(-12 * 60_000),
            acknowledged: true,
          },
        ],
      });
    }

    if (path.endsWith('/response-crew/teams') || path.endsWith('/response-crew/dispatches')) {
      return json({ data: [] });
    }

    // Keep unrelated app-shell requests deterministic without inventing operational records.
    return json({ data: [] });
  });
}

test.describe('Command Centre operator workspace', () => {
  test('desktop: prioritises incidents, opens evidence context and passes serious accessibility checks', async ({ page }) => {
    await seedAuth(page);
    await stubCommandApis(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/command', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active movements' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Regional theatre' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Priority response' })).toBeVisible();
    await expect(page.getByText('GPS reporting', { exact: true })).toBeVisible();
    await expect(page.getByText('Active convoys', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Response team')).toBeVisible();
    await expect(page.getByLabel('Dispatch priority')).toBeVisible();
    await expect(page.getByText('NORTH-01', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Nakuru checkpoint', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /CRITICAL/ }).click();
    await expect(page.getByText('Critical perimeter deviation')).toBeVisible();
    await expect(page.getByText('High cargo integrity alert')).toHaveCount(0);
    await expect(page.getByText('Medium vehicle speed observation')).toHaveCount(0);
    await expect(page.locator('.ccxq-record__type svg')).toHaveCount(1);

    await page.getByRole('button', { name: 'Open Critical perimeter deviation' }).click();
    const record = page.getByRole('dialog', { name: 'Critical perimeter deviation' });
    await expect(record).toBeVisible();
    await expect(record.getByText('Dashboard alert register')).toBeVisible();
    await expect(record.getByText('Vehicle departed the approved movement corridor.')).toBeVisible();
    await record.getByRole('button', { name: 'Close record detail' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: /ALL/ }).click();
    await expect(page.getByText('Seal evidence mismatch requires inspection before this load proceeds.')).toBeVisible();

    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();
    const serious = audit.violations.filter((violation) =>
      violation.impact === 'critical' || violation.impact === 'serious'
    );
    expect(serious, 'Critical/serious accessibility violations on Command Centre').toHaveLength(0);
  });

  test('retains the last convoy snapshot and marks a failed refresh', async ({ page }) => {
    await seedAuth(page);
    await stubCommandApis(page, { failSecondConvoyRefresh: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/command', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('NORTH-01', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Refresh all command centre data' }).click();
    await expect(page.getByText('Latest refresh failed — showing the last received movement register.')).toBeVisible();
    await expect(page.getByText('NORTH-01', { exact: true }).first()).toBeVisible();
  });

  test('mobile: keeps command controls and operational panels within the viewport', async ({ page }) => {
    await seedAuth(page);
    await stubCommandApis(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/command', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Command Centre' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh all command centre data' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Regional theatre' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Priority response' })).toBeVisible();
    await expect(page.getByText('GPS reporting', { exact: true })).toBeVisible();
    await expect(page.getByText('Active convoys', { exact: true })).toBeVisible();
    await expect(page.getByText('Open incidents', { exact: true })).toBeVisible();
    await expect(page.getByText('Open alerts', { exact: true })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document, 'Command Centre must not introduce horizontal page overflow on mobile').toBeLessThanOrEqual(dimensions.viewport);
  });

  test('partial sources never masquerade as secure or an empty schedule', async ({ page }) => {
    await seedAuth(page);
    await stubCommandApis(page, { partialSources: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/command', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('UNASSESSED', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Checkpoint source unavailable — movement progress is not assessed.')).toBeVisible();
    await expect(page.getByText('Schedule not fully assessed')).toBeVisible();
    await expect(page.getByText('No scheduled milestones')).toHaveCount(0);
    await expect(page.getByText(/PARTIAL MAP DATA/)).toBeVisible();
  });
});
