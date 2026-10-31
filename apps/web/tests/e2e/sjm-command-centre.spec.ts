import { expect, test, type Page, type TestInfo } from '@playwright/test';

const JOURNEY_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function pagedJourneyId(index: number): string {
  if (index === 0) return JOURNEY_ID;
  return '10000000-0000-4000-8000-' + String(index).padStart(12, '0');
}

const journey = {
  id: JOURNEY_ID,
  reference: 'SJM-E2E-001',
  title: 'Airport arrival — controlled transfer',
  purpose: 'Synthetic E2E fixture. Validate command-desk rendering only.',
  status: 'requested',
  service_type: 'airport_arrival',
  principal_reference: 'TEST-PRINCIPAL-001',
  airport_code: 'NBO',
  terminal: 'Terminal 1A',
  airline: 'Test Airline',
  flight_number: 'ZZ 100',
  flight_scheduled_at: '2026-10-29T08:00:00.000Z',
  flight_status: 'unknown',
  flight_status_source: 'not_recorded',
  flight_status_observed_at: null,
  flight_status_note: null,
  meet_greet_instructions: 'Synthetic fixture instructions only.',
  transport_mode: 'road',
  client_id: CLIENT_ID,
  client_name: 'SJM E2E Fixture Client',
  origin_label: 'JKIA Terminal 1A',
  origin_lat: -1.3192,
  origin_lng: 36.9275,
  destination_label: 'Nairobi CBD',
  destination_lat: -1.2864,
  destination_lng: 36.8172,
  planned_departure_at: '2026-10-29T08:00:00.000Z',
  planned_arrival_at: '2026-10-29T09:00:00.000Z',
  planned_distance_km: null,
  planned_duration_minutes: null,
  timezone: 'Africa/Nairobi',
  route_assessment: null,
  planned_route: [],
  human_review_decision: null,
  human_review_rationale: null,
  approved_at: null,
  started_at: null,
  completed_at: null,
  has_route_assessment: false,
  duty_roles: [],
  stops: [
    {
      id: 'stop-sjm-e2e-001',
      sequence: 1,
      name: 'Meet point',
      stop_type: 'meeting',
      lat: -1.3192,
      lng: 36.9275,
      planned_arrival_at: '2026-10-29T08:00:00.000Z',
      stop_status: 'planned',
      confirmed_at: null,
      confirmation_source: null,
      instructions: 'Synthetic fixture stop only.',
    },
  ],
  events: [],
  telemetry_snapshot: {
    status: 'UNAVAILABLE',
    reason: 'Synthetic E2E fixture; no operational telemetry is represented.',
    observed_at: null,
    devices: [],
  },
  readiness_checklist: [],
};

async function seedAuth(page: Page) {
  await page.addInitScript(({ user }: { user: object }) => {
    localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
  }, {
    user: {
      id: 'user-sjm-e2e-admin',
      name: 'SJM E2E Admin',
      email: 'sjm-e2e@example.invalid',
      role: 'admin',
      org_id: 'org-sjm-e2e',
    },
  });
}

async function stubSjmApi(page: Page) {
  let flightStatusObservation = { flight_status: journey.flight_status, flight_status_source: journey.flight_status_source, flight_status_observed_at: journey.flight_status_observed_at, flight_status_note: journey.flight_status_note };
  const flightStatusUpdates: Array<{flight_status:string;note:string|null}> = [];
  await page.route('**/api/v1/sjm/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === '/api/v1/sjm/airspace') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {
          provider: 'opensky_rest', provider_name: 'OpenSky Network',
          status: 'NOT_CONFIGURED', configured: false, connected: false,
          last_connected_at: null, last_received_at: null, last_position_at: null,
          message_count: 0, position_count: 0, rejected_count: 0,
          coverage: { complete: false, bounds: null, query_scope: 'unavailable' },
          aircraft: [], recent_events: [],
          poll_interval_seconds: null, credit_cost_per_request: null, credit_tier: null, credit_window: null, credit_budget: null,
          projected_credits_per_window: null, rate_limit_remaining: null,
          provenance: { source: 'OpenSky Network REST API', feed_mode: 'bounded_rest_polling_snapshot', fabricated_data_used: false },
        } }),
      });
    }
    if (pathname === '/api/v1/sjm/clients') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: CLIENT_ID, name: 'SJM E2E Fixture Client', company: 'Test only' }] }),
      });
    }
    if (pathname === '/api/v1/sjm/journeys/' + JOURNEY_ID + '/flight-status' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { flight_status: string; note?: string | null };
      const note = body.note?.trim() || null;
      flightStatusObservation = { flight_status: body.flight_status, flight_status_source: 'operator_entered', flight_status_observed_at: '2026-10-29T18:00:00.000Z', flight_status_note: note };
      flightStatusUpdates.push({ flight_status: body.flight_status, note });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: JOURNEY_ID, flight_status: body.flight_status, flight_status_source: 'operator_entered', flight_status_observed_at: flightStatusObservation.flight_status_observed_at }, provenance: { source: 'operator_entered', evidence_class: 'OPERATOR_ENTERED_UNVERIFIED', provider_feed_connected: false } }) });
    }
    if (pathname === '/api/v1/sjm/journeys' && route.request().method() === 'GET') {
      const requestUrl = new URL(route.request().url());
      const offset = Number(requestUrl.searchParams.get('offset') || 0);
      const limit = Number(requestUrl.searchParams.get('limit') || 100);
      const summary = { ...journey, ...flightStatusObservation };
      delete summary.stops;
      delete summary.events;
      delete summary.telemetry_snapshot;
      delete summary.readiness_checklist;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [summary], pagination: { limit, offset, total_count: 1, has_more: false }, summary: { total: 1, active: 0, queue: 1, review: 0, awaiting_review: 1, arrival_verification: 0 } }),
      });
    }
    const journeyDetailMatch = pathname.match(/^\/api\/v1\/sjm\/journeys\/([^/]+)$/);
    if (journeyDetailMatch && route.request().method() === 'GET') {
      const requestedId = decodeURIComponent(journeyDetailMatch[1]);
      if (requestedId === JOURNEY_ID) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { ...journey, ...flightStatusObservation } }),
        });
      }
      // The pagination E2E creates extra, synthetic register IDs. Return a
      // journey-shaped detail object for those IDs instead of { data: [] },
      // which is not a valid detail response and can crash the UI renderer.
      if (/^10000000-0000-4000-8000-\d{12}$/.test(requestedId)) {
        const suffix = requestedId.slice(-12);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { ...journey, id: requestedId, reference: 'SJM-PAGE-' + suffix } }),
        });
      }
    }
    if (pathname === '/api/v1/sjm/client-profiles/' + CLIENT_ID) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            client_id: CLIENT_ID,
            report_timezone: 'Africa/Nairobi',
            report_template: { title: 'SJM E2E Fixture Report', sections: ['summary', 'itinerary'] },
            daily_reports_enabled: false,
            daily_report_local_time: '18:00',
            daily_report_scheduler_available: false,
            client: { id: CLIENT_ID, name: 'SJM E2E Fixture Client' },
          },
        }),
      });
    }
    if (pathname === '/api/v1/sjm/journeys/' + JOURNEY_ID + '/participants') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/v1/messages/org-users', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { id: 'user-sjm-e2e-driver', name: 'Fixture Driver', role: 'operator' },
          { id: 'user-sjm-e2e-cpo', name: 'Fixture CPO', role: 'operator' },
        ],
      }),
    }),
  );
  return { flightStatusUpdates };
}

async function stubFieldSjmApi(page: Page, detail: Record<string, unknown> = { ...journey, duty_roles: ['driver'] }) {
  await page.route('**/api/v1/sjm/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === '/api/v1/sjm/my-assignments') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ ...journey, duty_roles: ['driver'] }] }),
      });
    }
    if (pathname === '/api/v1/sjm/journeys/' + JOURNEY_ID && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: detail }) });
    }
    if (pathname.endsWith('/communications')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            channel_id: 'channel-sjm-e2e-001',
            realtime_channel: 'org#org-sjm-e2e#comms#channel-sjm-e2e-001#v1',
            comms_epoch: 1,
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.route('**/api/v1/messages/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    }),
  );
}

test.describe('SJM command-centre responsive smoke', () => {
  test('legacy corridor URLs redirect to the standalone protective-mobility routes', async ({ page }) => {
    await seedAuth(page);
    await page.goto('/corridor/journeys', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/sjm$/);
    await page.goto('/corridor/missions', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/sjm\/field$/);
  });
  test('standalone field workspace exposes an authenticated sign-out action', async ({ page }) => {
    await seedAuth(page);
    await stubFieldSjmApi(page);
    await page.goto('/sjm/field', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Executive Mobility' })).toBeVisible({ timeout: 15000 });
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await expect(signOut).toBeVisible();
    await signOut.click();
    await expect(page).toHaveURL(/\/login$/);
  });
  // SJM lazily loads MapLibre and its mission workspace; allow for the cold CI Vite transform.
  test.describe.configure({ timeout: 120_000 });
  test('keeps the journey workspace readable without horizontal overflow at target viewports', async ({ page }, testInfo: TestInfo) => {
    await seedAuth(page);
    await stubSjmApi(page);

    const targets = [
      { width: 390, height: 844, label: 'mobile' },
      { width: 768, height: 1024, label: 'tablet' },
      { width: 1440, height: 900, label: 'desktop' },
      { width: 1920, height: 1080, label: 'large desktop' },
    ];

    for (const viewport of targets) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/sjm', { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('heading', { name: /Secure Journey Management/i })).toBeVisible({ timeout: 15000 });
      const sjmPageHeader = page.locator('main.sjm-console header.sjm-page-header');
      await expect(sjmPageHeader.getByText('Protective Mobility', { exact: true })).toBeVisible();
      await expect(sjmPageHeader.getByText('Command desk', { exact: true })).toBeVisible();
      await expect(sjmPageHeader.getByText('XD Live Surveillance', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Route has not been assessed', { exact: true })).toBeVisible();
      await expect(page.getByText('Not assessed', { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId('sjm-journey-progress')).toBeVisible();
      const lifecycle = page.getByTestId('sjm-journey-progress');
      await expect(lifecycle.getByRole('heading', { name: 'Lifecycle milestones' })).toBeVisible();
      const lifecycleStages = lifecycle.getByRole('list', { name: 'Journey stages' });
      await expect(lifecycleStages.getByRole('listitem')).toHaveCount(8);
      if (viewport.width < 640) {
        const lifecycleGrid = await lifecycleStages.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        expect(lifecycleGrid, 'mobile lifecycle must use readable two-column stage layout').toBe(2);
        for (const stageName of ['Request', 'Route', 'Review', 'Approval', 'Readiness', 'Movement', 'Arrival', 'Closeout']) {
          await expect(lifecycleStages.getByText(stageName, { exact: true })).toBeVisible();
        }
      }
      const serviceBrief = page.getByTestId('sjm-service-brief');
      await expect(serviceBrief).toBeVisible();
      await expect(serviceBrief.getByText('Airport arrival', { exact: true })).toBeVisible();
      await expect(serviceBrief.getByText('Test Airline · ZZ 100', { exact: true })).toBeVisible();
      await expect(serviceBrief.getByText('NBO · Terminal 1A', { exact: true })).toBeVisible();
      const flightStatusPanel = page.locator('section[aria-label="Flight status"]');
      await expect(flightStatusPanel.getByText('No observation recorded', { exact: true })).toBeVisible();
      await expect(flightStatusPanel.getByText('Entered by your team; this is not a live airline feed and is not independently verified.', { exact: true })).toBeVisible();
      await expect(serviceBrief.getByText('TEST-PRINCIPAL-001', { exact: true })).toBeVisible();
      await expect(serviceBrief.getByText('Synthetic fixture instructions only.', { exact: true })).toBeVisible();
      const operationsRail = page.locator('aside.sjm-journey-ops-rail');
      const commandGrid = page.getByTestId('sjm-command-grid');
      const commandColumns = await commandGrid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(commandColumns, viewport.label + ': command grid column count').toBe(viewport.width >= 1440 ? 3 : viewport.width >= 1280 ? 2 : 1);
      const operationsSections = operationsRail.locator('.sjm-live-ops-section');
      await expect(operationsRail).toBeVisible();
      await expect(operationsSections).toHaveCount(4);
      const railSurface = await operationsRail.locator('.sjm-live-ops-rail').evaluate((el) => ({
        borderWidth: getComputedStyle(el).borderTopWidth,
        radius: getComputedStyle(el).borderTopLeftRadius,
        background: getComputedStyle(el).backgroundColor,
      }));
      expect(railSurface.borderWidth).toBe('1px');
      expect(railSurface.radius).toBe('10px');
      expect(railSurface.background).toBe('rgb(12, 20, 29)');
      for (const section of await operationsSections.all()) {
        const style = await section.evaluate(el => ({
          borderTop: getComputedStyle(el).borderTopWidth,
          borderLeft: getComputedStyle(el).borderLeftWidth,
          radius: getComputedStyle(el).borderTopLeftRadius,
          background: getComputedStyle(el).backgroundColor,
        }));
        expect(style.borderTop).toBe('0px');
        expect(style.borderLeft).toBe('0px');
        expect(style.radius).toBe('0px');
        expect(style.background).toBe('rgba(0, 0, 0, 0)');
      }
      const overviewColumns = page.locator('.sjm-overview-columns');
      const riskPanel = page.locator('.sjm-overview-risk-panel');
      const overviewRail = page.locator('.sjm-overview-rail');
      await expect(overviewColumns).toBeVisible();
      const hierarchy = await overviewColumns.evaluate((el) => ({
        borderWidth: getComputedStyle(el).borderTopWidth,
        radius: getComputedStyle(el).borderTopLeftRadius,
        riskBorder: getComputedStyle(el.querySelector('.sjm-overview-risk-panel') as HTMLElement).borderTopWidth,
        riskBackground: getComputedStyle(el.querySelector('.sjm-overview-risk-panel') as HTMLElement).backgroundColor,
      }));
      expect(hierarchy.borderWidth).toBe('1px');
      expect(hierarchy.radius).toBe('10px');
      expect(hierarchy.riskBorder).toBe('0px');
      expect(hierarchy.riskBackground).toBe('rgba(0, 0, 0, 0)');
      const riskBox = await riskPanel.boundingBox();
      const railBox = await overviewRail.boundingBox();
      expect(riskBox, `${viewport.label}: route review region should render`).not.toBeNull();
      expect(railBox, `${viewport.label}: overview rail should render`).not.toBeNull();
      if (viewport.width >= 1440) {
        expect(Math.abs(riskBox!.y - railBox!.y), `${viewport.label}: route review and overview rail should align as one surface`).toBeLessThanOrEqual(1);
        expect(railBox!.x).toBeGreaterThan(riskBox!.x + riskBox!.width - 1);
      } else {
        expect(railBox!.y).toBeGreaterThanOrEqual(riskBox!.y + riskBox!.height - 1);
      }
      const basemapSelect = page.getByRole('combobox', { name: 'Map basemap' });
      await expect(basemapSelect).toHaveValue('dark');
      await expect(basemapSelect.locator('option')).toHaveText(['Street', 'Dark', 'Satellite']);
      const mapSurface = page.locator('[data-sjm-map="journey"]');
      await expect(page.getByRole('status', { name: 'No device locations to show' })).toBeVisible();
      await expect(page.getByRole('button', { name: /observed device layer/i })).toHaveCount(0);
      await expect(mapSurface).toHaveAttribute('data-sjm-map-state', 'ready', { timeout: 20000 });
      await expect(page.getByRole('region', { name: 'Interactive journey map showing planned locations and any assessed route' })).toBeVisible();
      if (viewport.width < 640) {
        await expect(mapSurface).toBeInViewport({ ratio: 0.5 });
        const mapControlYs = await page.locator('[data-testid="sjm-map-controls"] > *').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
        expect(mapControlYs).toHaveLength(3);
        expect(Math.max(...mapControlYs) - Math.min(...mapControlYs)).toBeLessThanOrEqual(6);
      }

      const pageHeader = page.locator('main header');
      const fieldTeamLink = pageHeader.getByRole('link', { name: /Field team app/ });
      const portfolioSummary = pageHeader.getByRole('button', { name: 'Portfolio summary', exact: true });
      if (viewport.width < 640) {
        await expect(fieldTeamLink).toBeHidden();
        await expect(portfolioSummary).toBeHidden();
        await expect(pageHeader.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
        await expect(pageHeader.getByRole('button', { name: 'New journey', exact: true })).toBeVisible();
      } else {
        await expect(fieldTeamLink).toBeVisible();
        await expect(portfolioSummary).toBeVisible();
      }

      const registerHeading = page.getByRole('heading', { name: 'Journey register' });
      const selectedMissionHeading = page.getByRole('heading', { name: 'Airport arrival — controlled transfer' });
      const registerBox = await registerHeading.boundingBox();
      const missionBox = await selectedMissionHeading.boundingBox();
      expect(registerBox, `${viewport.label}: register heading should render`).not.toBeNull();
      expect(missionBox, `${viewport.label}: selected mission heading should render`).not.toBeNull();
      if (viewport.width < 1280) {
        expect(missionBox!.y, `${viewport.label}: mission workspace must precede the register on narrow screens`).toBeLessThan(registerBox!.y);
      } else {
        expect(registerBox!.x, `${viewport.label}: register should remain the left desktop rail`).toBeLessThan(missionBox!.x);
      }

      const settledMapState = await mapSurface.getAttribute('data-sjm-map-state');
      expect(settledMapState, `${viewport.label}: map must settle before screenshot capture`).toBe('ready');
      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(
        dimensions.document,
        viewport.label + ': document width ' + dimensions.document + 'px exceeded viewport ' + dimensions.viewport + 'px',
      ).toBeLessThanOrEqual(viewport.width);
      expect(
        dimensions.body,
        viewport.label + ': body width ' + dimensions.body + 'px exceeded viewport ' + dimensions.viewport + 'px',
      ).toBeLessThanOrEqual(viewport.width);
      // Capture the opening workspace before component screenshots scroll the
      // dedicated SJM console to lower sections. This preserves first-screen QA.
      await testInfo.attach(`sjm-${viewport.label}-overview`, {
        body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
        contentType: 'image/png',
      });
      await serviceBrief.scrollIntoViewIfNeeded();
      await testInfo.attach(`sjm-${viewport.label}-service-brief`, {
        body: await serviceBrief.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });
      await testInfo.attach(`sjm-${viewport.label}-operations-rail`, {
        body: await operationsRail.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });

    }
  });

  test('mission resources are assigned to the journey directly', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    const resourcesTab = page.getByRole('tab', { name: 'Team & resources' });
    await expect(resourcesTab).toBeVisible();
    await resourcesTab.click();
    await expect(page.getByRole('heading', { name: 'Team & mission resources' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mission transport' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Field tracking & evidence sources' })).toBeVisible();
    await expect(page.getByText('No vehicles are assigned directly to this journey.')).toBeVisible();
    await expect(page.getByText('No Guardian devices are assigned directly to this journey.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Assign vehicles and devices' })).toBeVisible();
  });

  test('mobile mission selection returns focus to the map-first workspace', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    const secondJourneyId = '22222222-2222-4222-8222-222222222222';
    await page.route('**/api/v1/sjm/journeys?**', async (route) => {
      const summary = { ...journey };
      delete summary.stops;
      delete summary.events;
      delete summary.telemetry_snapshot;
      delete summary.readiness_checklist;
      const second = { ...summary, id: secondJourneyId, reference: 'SJM-E2E-002', title: 'Second executive transfer' };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [summary, second],
          pagination: { limit: 100, offset: 0, total_count: 2, has_more: false },
          summary: { total: 2, active: 0, queue: 2, review: 0, awaiting_review: 0, arrival_verification: 0 },
        }),
      });
    });
    await page.route('**/api/v1/sjm/journeys/' + secondJourneyId, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { ...journey, id: secondJourneyId, reference: 'SJM-E2E-002', title: 'Second executive transfer' } }),
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });

    const workspace = page.locator('#sjm-mission-workspace');
    const secondMission = page.getByRole('button', { name: /SJM-E2E-002/ });
    await secondMission.scrollIntoViewIfNeeded();
    await expect.poll(() => workspace.evaluate((node) => node.getBoundingClientRect().top)).toBeLessThan(0);
    await secondMission.click();
    const selectedHeading = page.getByRole('heading', { name: 'Second executive transfer' });
    await expect(selectedHeading).toBeVisible({ timeout: 15000 });
    await expect(selectedHeading).toBeFocused();
    await expect.poll(
      () => workspace.evaluate((node) => node.getBoundingClientRect().top),
      { timeout: 8000 },
    ).toBeGreaterThanOrEqual(0);
    await expect.poll(
      () => workspace.evaluate((node) => node.getBoundingClientRect().top),
      { timeout: 8000 },
    ).toBeLessThan(160);
  });

  test('mission workspace opens its authorised private communications channel', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    const missionChannelId = '00000000-0000-4000-8000-000000000123';
    const generalChannelId = '00000000-0000-4000-8000-000000000124';
    const channels = [
      {
        id: generalChannelId, name: 'General operations', slug: 'general-operations',
        type: 'public', category: 'operations', created_at: '2026-10-29T07:00:00.000Z',
        created_by: 'user-sjm-e2e-admin', realtime_channel: 'org#org-sjm-e2e#comms#general',
        muted: false, is_channel_admin: false, last_read_at: '2026-10-29T07:00:00.000Z',
        unread_count: 0, member_count: 4, last_message: null,
      },
      {
        id: missionChannelId, name: 'SJM-E2E-001 mission channel', slug: 'sjm-e2e-001',
        type: 'private', category: 'operations', created_at: '2026-10-29T07:00:00.000Z',
        created_by: 'user-sjm-e2e-admin', realtime_channel: 'org#org-sjm-e2e#comms#' + missionChannelId + '#v1',
        muted: false, is_channel_admin: true, last_read_at: '2026-10-29T07:00:00.000Z',
        unread_count: 0, member_count: 2, last_message: null,
      },
    ];
    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID + '/communications', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { channel_id: missionChannelId, realtime_channel: channels[1]!.realtime_channel, comms_epoch: 1 } }),
    }));
    await page.route((url) => url.pathname === '/api/v1/messages/channels', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: channels }),
    }));
    await page.route((url) => url.pathname.startsWith('/api/v1/messages/channels/' + missionChannelId + '/') ||
      url.pathname.startsWith('/api/v1/messages/channels/' + generalChannelId + '/'), (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, ok: true }),
    }));
    await page.route('**/api/v1/realtime/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'e2e-token' }),
    }));

    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Open secure channel' }).click();
    await page.waitForURL((url) => url.pathname === '/messages' && url.searchParams.get('channelId') === missionChannelId);
    await expect(page.locator('main header').getByText('SJM-E2E-001 mission channel', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('main header').getByText('General operations', { exact: true })).toHaveCount(0);
  });

  test('Ops Comms withholds channel history until the fresh authorised channel list settles', async ({ page }) => {
    await seedAuth(page);
    const channelId = '00000000-0000-4000-8000-000000000125';
    let releaseChannels!: () => void;
    let signalChannelsRequest!: () => void;
    const channelsRequestStarted = new Promise<void>((resolve) => { signalChannelsRequest = resolve; });
    const channelsGate = new Promise<void>((resolve) => { releaseChannels = resolve; });
    const privateQueries: string[] = [];

    await page.route((url) => url.pathname === '/api/v1/messages/channels', async (route) => {
      signalChannelsRequest();
      await channelsGate;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{
          id: channelId, name: 'Current authorised channel', slug: 'current-authorised-channel',
          type: 'private', category: 'operations', created_at: '2026-10-29T07:00:00.000Z',
          created_by: 'user-sjm-e2e-admin', realtime_channel: 'org#org-sjm-e2e#comms#' + channelId + '#v1',
          muted: false, is_channel_admin: true, last_read_at: '2026-10-29T07:00:00.000Z',
          unread_count: 0, member_count: 2, last_message: null,
        }] }),
      });
    });
    await page.route((url) => url.pathname === '/api/v1/messages/org-users', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }),
    }));
    await page.route((url) => url.pathname.startsWith('/api/v1/messages/channels/') , (route) => {
      privateQueries.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, ok: true }) });
    });
    await page.route('**/api/v1/realtime/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'e2e-token' }),
    }));

    await page.goto('/messages', { waitUntil: 'domcontentloaded' });
    await channelsRequestStarted;
    await expect(page.getByRole('heading', { name: 'Refreshing authorised communications scope' })).toBeVisible();
    expect(privateQueries).toEqual([]);
    await expect(page.getByText('Current authorised channel', { exact: true })).toHaveCount(0);

    releaseChannels();
    await expect(page.locator('main header').getByText('Current authorised channel', { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('an unauthorised channel deep-link never triggers private channel queries', async ({ page }) => {
    await seedAuth(page);
    const authorisedId = '00000000-0000-4000-8000-000000000124';
    const rejectedId = '00000000-0000-4000-8000-000000000123';
    const rejectedRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/v1/messages/channels/' + rejectedId + '/')) rejectedRequests.push(url.pathname);
    });
    await page.route((url) => url.pathname === '/api/v1/messages/channels', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{
        id: authorisedId, name: 'General operations', slug: 'general-operations',
        type: 'public', category: 'operations', created_at: '2026-10-29T07:00:00.000Z',
        created_by: 'user-sjm-e2e-admin', realtime_channel: 'org#org-sjm-e2e#comms#general',
        muted: false, is_channel_admin: false, last_read_at: '2026-10-29T07:00:00.000Z',
        unread_count: 0, member_count: 4, last_message: null,
      }] }),
    }));
    await page.route((url) => url.pathname.startsWith('/api/v1/messages/channels/' + authorisedId + '/'), (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], next_cursor: null, ok: true }),
    }));
    await page.route('**/api/v1/messages/org-users', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }),
    }));
    await page.route('**/api/v1/realtime/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'e2e-token' }),
    }));
    await page.goto('/messages?channelId=' + rejectedId, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main header').getByText('General operations', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(300);
    expect(rejectedRequests).toEqual([]);
  });

  test('registers a traveller, records a flight-ready dossier and executes a dated daily programme', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const workspace: {
      travellers: Array<Record<string, unknown>>;
      documents: Array<Record<string, unknown>>;
      flights: Array<Record<string, unknown>>;
      days: Array<Record<string, unknown>>;
      access: { manager: boolean; duty_roles: string[] };
      provenance: Record<string, string>;
    } = {
      travellers: [], documents: [], flights: [], days: [],
      access: { manager: true, duty_roles: [] },
      provenance: {},
    };
    const travellerId = '30000000-0000-4000-8000-000000000001';
    const dayId = '30000000-0000-4000-8000-000000000002';
    const itemId = '30000000-0000-4000-8000-000000000003';

    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID + '/travel-workspace', async route => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: workspace }) });
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (method === 'POST' && route.request().url().endsWith('/travellers')) {
        const traveller = {
          id: travellerId, ...body,
          display_name: [body.title, body.given_name, body.middle_name, body.family_name].filter(Boolean).join(' '),
        };
        workspace.travellers.push(traveller);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: traveller }) });
      }
      if (method === 'POST' && route.request().url().endsWith('/days')) {
        const day = { id: dayId, ...body, timezone: 'Africa/Nairobi', items: [] };
        workspace.days.push(day);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: day }) });
      }
      if (method === 'POST' && route.request().url().endsWith('/items')) {
        const day = workspace.days[0] as { items: Array<Record<string, unknown>> };
        const item = { id: itemId, sequence: 1, execution_status: 'planned', ...body };
        day.items.push(item);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: item }) });
      }
      if (method === 'PATCH' && route.request().url().endsWith('/execution')) {
        const item = (workspace.days[0] as { items: Array<Record<string, unknown>> }).items[0];
        Object.assign(item, body);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: item }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected_travel_workspace_request' }) });
    });

    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('tab', { name: 'Travel & programme' }).click();
    await expect(page.getByRole('heading', { name: 'Traveller register' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Flight segments' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Daily travel programme & execution' })).toBeVisible();

    await page.getByLabel('Traveller reference *').fill('TRV-E2E-01');
    await page.getByLabel('Given name *').fill('Amina');
    await page.getByLabel('Family name *').fill('Example');
    await page.getByLabel('Nationality').fill('Kenyan');
    await page.getByLabel('Email').fill('amina@example.invalid');
    await page.getByRole('button', { name: 'Register traveller' }).click();
    await expect(page.getByText('Amina Example', { exact: true })).toBeVisible();
    await expect(page.getByText('Traveller profile registered to this journey.')).toBeVisible();

    await page.getByLabel('Local date').fill('2026-10-31');
    await page.getByLabel('Day title').fill('Day 1 · Arrival and reception');
    await page.getByRole('button', { name: 'Add day' }).click();
    await expect(page.getByRole('heading', { name: 'Day 1 · Arrival and reception' })).toBeVisible();

    await page.getByLabel('Activity title *').fill('Airport meet and greet');
    await page.getByLabel(/Planned start/).fill('2026-10-31T10:00');
    await page.getByLabel(/Planned end/).fill('2026-10-31T11:00');
    await page.getByLabel('Location / venue').fill('Jomo Kenyatta International Airport');
    await page.getByLabel('Activity instructions').fill('Receive traveller at the agreed arrival point and coordinate handover.');
    await page.getByRole('button', { name: 'Add activity to day' }).click();
    await expect(page.getByText('Airport meet and greet', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('Execution update recorded in the activity history.')).toBeVisible();
    await page.getByLabel('Execution note').fill('Traveller received and identity matched to the movement brief.');
    await page.getByRole('button', { name: 'Complete' }).click();
    await expect(page.getByText('Execution update recorded in the activity history.')).toBeVisible();
  });

  test('workspace tabs remain operable and preserve evidence provenance on a narrow viewport', async ({ page }) => {
    const cspRuntimeErrors: string[] = [];
    page.on('pageerror', (error) => {
      if (/Content Security Policy|unsafe-eval|WebAssembly/i.test(error.message)) cspRuntimeErrors.push(error.message);
    });
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    const tabs = page.getByRole('tablist', { name: 'Journey workspace views' });
    await expect(tabs).toBeVisible();

    await page.getByRole('tab', { name: 'Evidence' }).click();
    await expect(page.getByRole('heading', { name: 'Journey events' })).toBeVisible();
    await expect(page.getByText('Manual stop confirmations', { exact: true })).toBeVisible();
    await expect(page.getByText('A manual confirmation does not prove GPS arrival.', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { name: 'Generate report' })).toBeVisible();
    await expect(page.getByText(/Reports are downloaded here/)).toBeVisible();

    await page.getByRole('tab', { name: 'Airspace 3D' }).click();
    await expect(page.getByRole('heading', { name: '3D airspace' })).toBeVisible();
    await expect(page.getByText('OpenSky access is not configured.')).toBeVisible();
    await expect(page.getByText('Plottable observations', { exact: true })).toBeVisible();
    await expect(page.getByText('OpenSky state vectors', { exact: true })).toBeVisible();
    await expect(page.getByText('ADSB.lol regional records', { exact: true })).toBeVisible();
    const adsbAttribution = page.locator('p').filter({ hasText: 'Source: ADSB.lol · ODbL 1.0.' });
    await expect(adsbAttribution).toContainText('Commercial use is permitted');
    await expect(adsbAttribution).toContainText('public API is best-effort');
    await expect(page.getByText('No aircraft are simulated.')).toBeVisible();
    expect(cspRuntimeErrors).toEqual([]);
  });


  test('airspace observation index is keyboard-operable and preserves unresolved altitude references', async ({ page }, testInfo: TestInfo) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.route('**/api/v1/sjm/airspace**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {
        provider: 'opensky_rest',
        provider_name: 'OpenSky Network',
        status: 'LIVE',
        configured: true,
        connected: true,
        last_received_at: '2026-10-30T11:30:00.000Z',
        last_position_at: '2026-10-30T11:29:45.000Z',
        message_count: 1,
        position_count: 1,
        rejected_count: 0,
        coverage: { complete: false, bounds: { south: -5, west: 30, north: 5, east: 45 }, query_scope: 'bounded' },
        intelligence: {
          generated_at: '2026-10-30T11:30:00.000Z',
          providers: [
            { id: 'opensky', name: 'OpenSky Network', capability: 'aircraft_positions', status: 'LIVE', role: 'Primary bounded aircraft state vectors' },
            { id: 'flyitalyadsb', name: 'FlyItalyADSB', capability: 'regional_aircraft_positions', status: 'AVAILABLE', role: 'Independent informational aircraft observations', license: 'CC-BY-SA-4.0', commercial_use_permitted: true, attribution_required: true, share_alike_required: true, service_level: 'BEST_EFFORT', maximum_radius_km: 500, requests_per_minute: 25, requests_per_month: 270000, provider_plan_requests_per_minute: 30, provider_plan_requests_per_month: 300000, quota_scope: 'shared_product_key' },
          ],
          aircraft_area: {
            status: 'NOT_REQUESTED', configured: false, reason: 'ADSB.lol is not enabled in this fixture',
            records: [], record_count: 0, radius_nm: 250, source: 'ADSB.lol', license: 'ODbL-1.0',
          },
          flyitaly_area: {
            status: 'AVAILABLE', configured: true, radius_km: 500, record_count: 1, rejected_count: 0,
            source: 'FlyItalyADSB', license: 'CC-BY-SA-4.0', attribution_required: true, share_alike_required: true,
            coverage: { complete: false, query_scope: 'airport_centred_radius', centre: { icao: 'HKJK', latitude: -1.3192, longitude: 36.9278 }, radius_km: 500 },
            records: [{
              id: 'abc123', map_key: 'flyitalyadsb:abc123', provider: 'flyitalyadsb', position_provider: 'flyitalyadsb',
              position_source: 'adsb_icao', position_source_label: 'FlyItalyADSB ADS-B', aircraft_type: 'B789',
              ident: 'KQFILL', latitude: -1.31, longitude: 36.92,
              altitude_m: 11000, altitude_reference: 'WGS84_ELLIPSOID', ground_speed_mps: 220, heading_deg: 95,
              observed_at: '2026-10-30T11:29:45.000Z', age_seconds: 15, freshness: 'LIVE', trail: [],
            }],
          },
          flight_status: {
            status: 'NOT_CONFIGURED', reason: 'No commercial flight provider is configured',
            flight_number: 'ZZ 100', flights: [], source: 'AeroDataBox', checked_at: '2026-10-30T11:30:00.000Z',
          },
          aircraft_cross_check: { status: 'NOT_CONFIGURED', records: [], source: 'ADSB.lol' },
          aircraft_comparison: { status: 'NOT_REQUESTED', note: 'No OpenSky/ADSB.lol cross-check was requested in this fixture.', primary_count: 0, secondary_count: 0 },
          aviation_weather: { status: 'NOT_REQUESTED', reason: 'Weather not requested in this fixture', station_icao: null, metar: [], taf: [], international_sigmets: [] },
          notams: {
            status: 'ACCESS_REQUIRED', source: 'KCAA AIM / Nairobi FIR',
            message: 'Official NOTAM access requires an authorised account.',
            url: 'https://aim.kcaa.or.ke/', global_source: 'EUROCONTROL MyEAD requires a system-to-system agreement.',
          },
          airport_reference: {
            status: 'RESOLVED', supplied_code: 'NBO', supplied_code_type: 'IATA', candidate_count: 1,
            airport: { iata: 'NBO', icao: 'HKJK', name: 'Jomo Kenyatta International Airport', municipality: 'Nairobi', country_code: 'KE', latitude: -1.3192, longitude: 36.9278, airport_type: 'large_airport', scheduled_service: true },
            source: 'OurAirports', sources: ['OurAirports Public Domain'],
            warning: 'Airport reference is not certified navigation data.',
          },
          provenance: {
            multi_provider: true, active_provider_count: 2, active_reference_source_count: 1,
            provider_registry_present: true, fabricated_data_used: false, providers_are_not_equivalent_authorities: true,
          },
        },
        poll_interval_seconds: 30,
        aircraft: [{
          id: '4b1234',
          map_key: 'opensky_rest:4b1234',
          provider: 'opensky_rest',
          position_provider: 'opensky_rest',
          position_source_label: 'OpenSky ADS-B state',
          ident: 'KQA123',
          latitude: -1.3192,
          longitude: 36.9278,
          altitude_m: 10668,
          altitude_reference: 'BAROMETRIC_PRESSURE',
          ground_speed_mps: 230,
          heading_deg: 92,
          observed_at: '2026-10-30T11:29:45.000Z',
          age_seconds: 15,
          freshness: 'LIVE',
          trail: [],
        }],
        recent_events: [],
        provenance: { fabricated_data_used: false },
      } }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('tab', { name: 'Airspace 3D' }).click();
    const display = page.getByTestId('sjm-airspace-display');
    await expect(display).toBeVisible();
    await expect(page.getByText('Commercial flight status', { exact: true })).toBeVisible();
    await expect(page.getByText('No commercial flight provider is configured', { exact: true })).toBeVisible();
    const globe = display.getByRole('application', { name: /three-dimensional airspace globe/i });
    await expect(globe).toBeVisible();
    await expect(globe).toHaveAttribute('data-basemap-provider', 'openstreetmap');
    await expect(display.getByText('AIRSPACE / HKJK · Nairobi')).toBeVisible();
    await expect(globe).toHaveAttribute('data-camera-mode', 'orbital');
    await expect(display.getByTestId('sjm-airspace-basemap-credit').getByRole('link', { name: '© OpenStreetMap contributors' })).toBeVisible();
    const orbitalView = display.getByRole('button', { name: 'Orbital 3D view' });
    const regionalView = display.getByRole('button', { name: 'Regional map view' });
    await expect(orbitalView).toHaveAttribute('aria-pressed', 'true');
    await testInfo.attach('sjm-airspace-orbital-view', { body: await display.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await regionalView.click();
    await expect(regionalView).toHaveAttribute('aria-pressed', 'true');
    await expect(globe).toHaveAttribute('data-camera-mode', 'regional');
    await expect(globe).toHaveAttribute('data-regional-centre-latitude', '-1.3192');
    await expect(globe).toHaveAttribute('data-regional-centre-longitude', '36.9278');
    await expect(globe).toHaveAttribute('data-regional-camera-height-m', '1250000');
    await expect(globe).toHaveAttribute('data-regional-radius-nm', '250');
    await orbitalView.click();
    await expect(orbitalView).toHaveAttribute('aria-pressed', 'true');
    await expect(globe).toHaveAttribute('data-camera-mode', 'orbital');
    await expect(globe.locator('canvas')).toBeVisible();
    const observationList = page.getByRole('list', { name: 'Aircraft observation list' });
    const providerFilter = display.getByRole('combobox', { name: 'Filter aircraft provider' });
    await providerFilter.selectOption('opensky_rest');
    await expect(observationList.getByRole('button', { name: /KQA123/ })).toBeVisible();
    await providerFilter.selectOption('flyitalyadsb');
    await expect(observationList.getByRole('button', { name: /KQFILL/ })).toBeVisible();
    const flyItalyCredit = display.getByRole('link', { name: 'FlyItalyADSB' });
    await expect(flyItalyCredit).toBeVisible();
    await expect(flyItalyCredit).toHaveAttribute('href', 'https://flyitalyadsb.com/');
    const flyItalyLicence = display.getByRole('link', { name: 'CC BY-SA 4.0' });
    await expect(flyItalyLicence).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
    await providerFilter.selectOption('all');
    const emptyInspector = display.getByTestId('sjm-aircraft-unselected-inspector');
    await expect(emptyInspector).toContainText('Select an aircraft observation');
    await expect(emptyInspector).toContainText('Coverage bounds');
    await expect(emptyInspector).toContainText('30s cadence');
    const aircraftRow = observationList.getByRole('button', { name: /KQA123/ });
    await aircraftRow.focus();
    await expect(aircraftRow).toBeFocused();
    await page.keyboard.press('Enter');
    const selected = page.getByRole('region', { name: 'Selected aircraft observation' });
    await expect(selected).toBeVisible();
    await expect(selected.getByText('Barometric pressure', { exact: true })).toBeVisible();
    await expect(selected.getByText('Not converted or plotted vertically; marker remains at the reference surface.', { exact: true })).toBeVisible();
    await expect(selected).toContainText(/10[,.]668 m/);
    const focusAircraft = selected.getByTestId('sjm-aircraft-focus');
    await expect(focusAircraft).toBeVisible();
    await focusAircraft.click();
    const credit = display.getByTestId('sjm-airspace-basemap-credit');
    const globeBox = await globe.boundingBox();
    const creditBox = await credit.boundingBox();
    expect(globeBox).not.toBeNull();
    expect(creditBox).not.toBeNull();
    expect(creditBox!.y + creditBox!.height).toBeLessThan(globeBox!.y + globeBox!.height - 32);
    await testInfo.attach('sjm-airspace-selected-aircraft', { body: await display.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(display).toBeVisible();
    const mobileGrid = display.locator(':scope > div.grid').first();
    const mobileColumns = await mobileGrid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(mobileColumns, '390px airspace workspace stacks globe and inspector').toBe(1);
    await expect(display.getByRole('complementary', { name: 'Aircraft inspection' })).toBeVisible();
    const mobileGlobeBox = await globe.boundingBox();
    const mobileCreditBox = await credit.boundingBox();
    expect(mobileGlobeBox).not.toBeNull();
    expect(mobileCreditBox).not.toBeNull();
    expect(mobileCreditBox!.y + mobileCreditBox!.height).toBeLessThan(mobileGlobeBox!.y + mobileGlobeBox!.height - 32);
    await testInfo.attach('sjm-airspace-mobile-390', { body: await display.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  });

  test('flight status can be recorded as an audited operator observation', async ({ page }) => {
    await seedAuth(page);
    const { flightStatusUpdates } = await stubSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });

    const flightCard = page.getByRole('region', { name: 'Flight status' });
    await expect(flightCard).toBeVisible({ timeout: 15000 });
    await expect(flightCard.getByText('Not recorded', { exact: true }).first()).toBeVisible();
    await expect(flightCard.getByText(/not a live airline feed/i)).toBeVisible();

    await flightCard.getByRole('button', { name: 'Record flight status' }).click();
    await flightCard.getByLabel('Flight status').selectOption('delayed');
    await expect(flightCard.getByRole('button', { name: 'Save flight observation' })).toBeDisabled();
    await flightCard.getByLabel('Observation note').fill('Airline desk reported a 35 minute delay.');
    await expect(flightCard.getByRole('button', { name: 'Save flight observation' })).toBeEnabled();
    await flightCard.getByRole('button', { name: 'Save flight observation' }).click();

    await expect.poll(() => flightStatusUpdates).toEqual([{ flight_status: 'delayed', note: 'Airline desk reported a 35 minute delay.' }]);
    await expect(flightCard.getByTestId('sjm-flight-status-value')).toHaveText('Delayed');
    await expect(flightCard.getByText('Operator-entered', { exact: true })).toBeVisible();
    await expect(flightCard.getByText('Airline desk reported a 35 minute delay.')).toBeVisible();
  });

  test('late flight-status response cannot overwrite another journey draft', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    const secondJourneyId = '33333333-3333-4333-8333-333333333333';
    await page.route('**/api/v1/sjm/journeys?**', async (route) => {
      const summary = { ...journey };
      delete summary.stops; delete summary.events; delete summary.telemetry_snapshot; delete summary.readiness_checklist;
      const second = { ...summary, id: secondJourneyId, reference: 'SJM-E2E-002', title: 'Second executive transfer', flight_number: 'ZZ 200', flight_status: 'scheduled', flight_status_source: 'not_recorded', flight_status_observed_at: null, flight_status_note: null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        data: [summary, second], pagination: { limit: 100, offset: 0, total_count: 2, has_more: false },
        summary: { total: 2, active: 0, queue: 2, review: 0, awaiting_review: 0, arrival_verification: 0 },
      }) });
    });
    await page.route('**/api/v1/sjm/journeys/' + secondJourneyId, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { ...journey, id: secondJourneyId, reference: 'SJM-E2E-002', title: 'Second executive transfer', flight_number: 'ZZ 200', flight_status: 'scheduled', flight_status_source: 'not_recorded', flight_status_observed_at: null, flight_status_note: null } }),
    }));

    let releaseFirstSave: (() => void) | undefined;
    let markFirstSaveStarted: (() => void) | undefined;
    const firstSaveStarted = new Promise<void>((resolve) => { markFirstSaveStarted = resolve; });
    const firstSaveResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/sjm/journeys/' + JOURNEY_ID + '/flight-status' && response.request().method() === 'PATCH';
    });
    await page.route((url) => url.pathname === '/api/v1/sjm/journeys/' + JOURNEY_ID + '/flight-status', async (route) => {
      markFirstSaveStarted?.();
      await new Promise<void>((resolve) => { releaseFirstSave = resolve; });
      const body = route.request().postDataJSON() as { flight_status: string; note?: string | null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        data: { id: JOURNEY_ID, flight_status: body.flight_status, flight_status_source: 'operator_entered', flight_status_observed_at: '2026-10-29T18:00:00.000Z' },
        provenance: { source: 'operator_entered', evidence_class: 'OPERATOR_ENTERED_UNVERIFIED', provider_feed_connected: false },
      }) });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    const firstCard = page.getByRole('region', { name: 'Flight status' });
    await firstCard.getByRole('button', { name: 'Record flight status' }).click();
    await firstCard.getByLabel('Flight status').selectOption('delayed');
    await firstCard.getByLabel('Observation note').fill('First journey delay awaiting confirmation.');
    await firstCard.getByRole('button', { name: 'Save flight observation' }).click();
    await firstSaveStarted;

    const secondMission = page.getByRole('button', { name: /SJM-E2E-002/ });
    await secondMission.scrollIntoViewIfNeeded();
    await secondMission.click();
    await expect(page.getByRole('heading', { name: 'Second executive transfer' })).toBeVisible({ timeout: 15000 });
    const secondCard = page.getByRole('region', { name: 'Flight status' });
    await secondCard.getByRole('button', { name: 'Record flight status' }).click();
    await secondCard.getByLabel('Flight status').selectOption('landed');
    await secondCard.getByLabel('Observation note').fill('Second journey draft remains unsent.');
    await expect(secondCard.getByLabel('Flight status')).toHaveValue('landed');

    if (!releaseFirstSave) throw new Error('The first flight-status request did not reach the hold point.');
    releaseFirstSave();
    await firstSaveResponse;
    await expect(secondCard.getByLabel('Flight status')).toHaveValue('landed');
    await expect(secondCard.getByLabel('Observation note')).toHaveValue('Second journey draft remains unsent.');
    await expect(secondCard.getByRole('button', { name: 'Save flight observation' })).toBeVisible();
    await expect(secondCard.getByTestId('sjm-flight-status-value')).toHaveText('Scheduled');
    await expect(secondCard.getByText('First journey delay awaiting confirmation.')).toHaveCount(0);
  });

  test('team assignments stay out of the initial dispatch path until requested', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });

    const team = page.locator('details.sjm-team-admin');
    await expect(team).toBeVisible({ timeout: 15000 });
    await expect(team).not.toHaveAttribute('open', '');
    await expect(team.getByRole('heading', { name: 'Assigned drivers, CPOs and meet-and-greet staff' })).toBeVisible();
    await expect(team.getByLabel('Team member')).not.toBeVisible();

    await team.locator('summary').click();
    await expect(team).toHaveAttribute('open', '');
    await expect(team.getByLabel('Team member')).toBeVisible();
  });



  test('field workspace stays locked until the authenticated assignment refresh settles', async ({ page }) => {
    await seedAuth(page);
    await stubFieldSjmApi(page);

    let releaseAssignments!: () => void;
    let signalAssignmentsRequest!: () => void;
    const assignmentsRequestStarted = new Promise<void>((resolve) => { signalAssignmentsRequest = resolve; });
    const assignmentsGate = new Promise<void>((resolve) => { releaseAssignments = resolve; });

    // Override the broad field stub and deliberately hold the fresh assignment
    // response. The stale-cache path must not render the mission before release.
    await page.route('**/api/v1/sjm/my-assignments', async (route) => {
      signalAssignmentsRequest();
      await assignmentsGate;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ ...journey, duty_roles: ['driver'] }] }),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm/field', { waitUntil: 'domcontentloaded' });
    await assignmentsRequestStarted;

    await expect(page.getByText('Refreshing authorised mission scope…')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).not.toBeVisible();

    releaseAssignments();
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
  });

  test('field app withholds cached mission details when the server revokes access', async ({ page }) => {
    await seedAuth(page);
    await stubFieldSjmApi(page);
    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'journey_not_found' }),
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm/field', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('A mission is no longer in your authorised assignment list. Its sensitive details have been removed.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Synthetic fixture instructions only.')).not.toBeVisible();
    await expect(page.getByTestId('sjm-field-route-map')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).not.toBeVisible();
    await expect(page.getByText('Principal / booking reference: TEST-PRINCIPAL-001')).not.toBeVisible();
  });

  test('field route map shows locations without inventing an unassessed route', async ({ page }) => {
    await seedAuth(page);
    await stubFieldSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm/field', { waitUntil: 'domcontentloaded' });

    const routeMap = page.getByTestId('sjm-field-route-map');
    await expect(routeMap).toBeVisible({ timeout: 15000 });
    await expect(routeMap).toHaveAttribute('data-route-evidence', 'unavailable');
    await expect(page.getByText('No routed Route Safety geometry is available. The map does not connect endpoints.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Ordered checkpoints' }).getByText('Meet point')).toBeVisible();
    await expect(page.getByText(/no live position inferred/)).toBeVisible();
  });

  test('field route map draws only stored routed geometry and labels its safety gate', async ({ page }) => {
    await seedAuth(page);
    const routedDetail = {
      ...journey,
      duty_roles: ['driver'],
      route_assessment: { route_status: 'routed', safety_gate: 'GO' },
      planned_route: [
        { lat: -1.3192, lng: 36.9275 },
        { lat: -1.3020, lng: 36.9000 },
        { lat: -1.2864, lng: 36.8172 },
      ],
    };
    await stubFieldSjmApi(page, routedDetail);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm/field', { waitUntil: 'domcontentloaded' });

    const routeMap = page.getByTestId('sjm-field-route-map');
    await expect(routeMap).toBeVisible({ timeout: 15000 });
    await expect(routeMap).toHaveAttribute('data-route-evidence', 'routed');
    await expect(routeMap.getByText('Route Safety · GO')).toBeVisible();
    await expect(routeMap.getByText('The line is stored Route Safety planned geometry, not a live GPS track.')).toBeVisible();
    const mapTop = await routeMap.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
    const instructionsTop = await page.getByText('Synthetic fixture instructions only.').evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
    expect(mapTop).toBeLessThan(instructionsTop);
  });

  test('field communications appear before check-in actions on a narrow screen', async ({ page }) => {
    await seedAuth(page);
    await stubFieldSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm/field', { waitUntil: 'domcontentloaded' });

    const communications = page.getByRole('heading', { name: 'Private mission channel' });
    const milestones = page.getByRole('heading', { name: 'Mission milestones' });
    await expect(communications).toBeVisible({ timeout: 15000 });
    await expect(milestones).toBeVisible();
    const communicationsTop = await communications.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
    const milestonesTop = await milestones.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
    expect(communicationsTop).toBeLessThan(milestonesTop);
  });

  test('field communications distinguish failed history loads from an empty channel', async ({ page }) => {
    await seedAuth(page);
    await stubFieldSjmApi(page);
    await page.route('**/api/v1/messages/**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'message_history_unavailable' }),
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm/field', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Private mission channel' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Message history could not be loaded. No empty-state assumption is made.')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('No messages recorded in this mission channel.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry history' })).toBeVisible();
  });

  test('register exposes full result counts and bounded page navigation', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    let requestedOffset = -1;
    let requestedSort = '';
    let requestedFilter = 'all';
    await page.route('**/api/v1/sjm/journeys?**', async (route) => {
      const url = new URL(route.request().url());
      requestedOffset = Number(url.searchParams.get('offset') || 0);
      requestedSort = url.searchParams.get('sort') || '';
      requestedFilter = url.searchParams.get('filter') || 'all';
      const summary = { ...journey };
      delete summary.stops;
      delete summary.events;
      delete summary.telemetry_snapshot;
      delete summary.readiness_checklist;
      const offset = requestedOffset;
      const totalCount = requestedFilter === 'overdue' ? 7 : requestedFilter === 'departure_due_30m' ? 3 : 176;
      const rowCount = Math.max(0, Math.min(offset === 0 ? 100 : 76, totalCount - offset));
      const data = Array.from({ length: rowCount }, (_, index) => ({
        ...summary,
        id: pagedJourneyId(offset + index),
        reference: 'SJM-PAGE-' + (offset + index),
        schedule_urgency: requestedFilter === 'overdue' ? 'DEPARTURE_OVERDUE' : requestedFilter === 'departure_due_30m' ? 'DEPARTURE_DUE_30M' : null,
      }));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data,
          pagination: { limit: 100, offset, total_count: totalCount, has_more: offset + rowCount < totalCount },
          summary: { total: 176, active: 32, queue: 48, review: 14, awaiting_review: 13, arrival_verification: 11, overdue: 7, departures_due_30m: 3 },
        }),
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('176 matches')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Register summary: 176 journeys', { exact: false })).toBeVisible();
    const registerResponse = (offset: string, filter?: string, sort?: string) => page.waitForResponse((response) => {
      if (response.request().method() !== 'GET') return false;
      const url = new URL(response.url());
      return url.pathname === '/api/v1/sjm/journeys'
        && url.searchParams.get('offset') === offset
        && (filter === undefined || (url.searchParams.get('filter') || 'all') === filter)
        && (sort === undefined || (url.searchParams.get('sort') || '') === sort);
    }, { timeout: 15000 });

    const nextPage = page.getByRole('button', { name: 'Next register page' });
    await expect(nextPage).toBeEnabled();
    const secondPageResponse = registerResponse('100', 'all');
    await nextPage.click();
    await secondPageResponse;
    await expect.poll(() => requestedOffset).toBe(100);
    await expect(page.getByText('Showing 101–176 of 176')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous register page' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Next register page' })).toBeDisabled();

    const sortedRegisterResponse = registerResponse('0', 'all', 'departure_asc');
    await page.getByLabel('Sort journeys').selectOption('departure_asc');
    await sortedRegisterResponse;
    await expect.poll(() => requestedSort).toBe('departure_asc');
    await expect.poll(() => requestedOffset).toBe(0);
    await expect(page.getByText('Showing 1–100 of 176')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next register page' })).toBeEnabled();

    const overdueResponse = registerResponse('0', 'overdue', 'departure_asc');
    await page.getByRole('button', { name: 'Overdue' }).click();
    await overdueResponse;
    await expect.poll(() => requestedFilter).toBe('overdue');
    await expect.poll(() => requestedOffset).toBe(0);
    await expect(page.getByText('7 matches')).toBeVisible();
    await expect(page.getByText('Showing 1–7 of 7')).toBeVisible();
    await expect(page.getByRole('button', { name: /SJM-PAGE-0/ }).getByText('Departure overdue')).toBeVisible();

    const departureDueResponse = registerResponse('0', 'departure_due_30m', 'departure_asc');
    await page.getByRole('button', { name: 'Departing soon' }).click();
    await departureDueResponse;
    await expect.poll(() => requestedFilter).toBe('departure_due_30m');
    await expect.poll(() => requestedOffset).toBe(0);
    await expect(page.getByText('3 matches')).toBeVisible();
    await expect(page.getByRole('button', { name: /SJM-PAGE-0/ }).getByText('Departing soon')).toBeVisible();
  });

  test('lifecycle rail keeps movement and arrival verification on their correct checkpoints', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    const moving = { ...journey, status: 'in_progress', approved_at: '2026-10-29T07:30:00.000Z', started_at: '2026-10-29T08:00:00.000Z' };
    const summary = { ...moving };
    delete summary.stops;
    delete summary.events;
    delete summary.telemetry_snapshot;
    delete summary.readiness_checklist;
    await page.route('**/api/v1/sjm/journeys?**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [summary], pagination: { limit: 100, offset: 0, total_count: 1, has_more: false }, summary: { total: 1, active: 1, queue: 0, review: 0, awaiting_review: 0, arrival_verification: 0 } }),
    }));
    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: moving }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('sjm-journey-progress').getByText('Stage 6 of 8')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('sjm-journey-progress').getByRole('listitem', { name: 'Overview Movement current' })).toBeVisible();
    await expect(page.getByTestId('sjm-journey-progress').getByRole('listitem', { name: 'Overview Arrival upcoming' })).toBeVisible();
  });


  test('field evidence remains pending until the private object is verified by Sonalit', async ({ page }) => {
    await seedAuth(page);
    await stubFieldSjmApi(page, { ...journey, duty_roles: ['driver'] });
    await page.setViewportSize({ width: 390, height: 844 });

    const evidencePath = '/api/v1/sjm/journeys/' + JOURNEY_ID + '/evidence';
    const evidenceId = '33333333-3333-4333-8333-333333333333';
    let objectUploaded = false;
    let recordVerified = false;
    const record = {
      id: evidenceId, category: 'photo', file_name: 'arrival-proof.jpg',
      mime_type: 'image/jpeg', size_bytes: 4, status: 'VERIFIED',
      sha256: 'a'.repeat(64), created_at: '2026-10-31T09:30:00.000Z',
      location_source: 'NOT_CAPTURED',
    };

    await page.route('**' + evidencePath, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: recordVerified ? [record] : [] }),
      });
    });
    await page.route('**' + evidencePath + '/upload-url', async route => {
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ data: {
          id: evidenceId, status: 'UPLOAD_PENDING',
          upload_url: 'https://sjm-test-account.r2.cloudflarestorage.com/signed-put',
          required_headers: {
            'Content-Type': 'image/jpeg',
            'If-None-Match': '*',
            'x-amz-meta-evidence-id': evidenceId,
            'x-amz-meta-journey-id': JOURNEY_ID,
          },
        } }),
      });
    });
    await page.route('**' + evidencePath + '/' + evidenceId + '/commit', async route => {
      if (!objectUploaded) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'evidence_upload_missing' }) });
      }
      recordVerified = true;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { id: evidenceId, status: 'VERIFIED', sha256: record.sha256 } }),
      });
    });
    // Use the real R2 S3 hostname pattern allowed by the production connect-src CSP.
    await page.route('https://sjm-test-account.r2.cloudflarestorage.com/**', async route => {
      const method = route.request().method();
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'PUT, OPTIONS',
        'access-control-allow-headers': 'Content-Type, If-None-Match, x-amz-meta-evidence-id, x-amz-meta-journey-id',
      };
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (method === 'PUT') {
        objectUploaded = true;
        return route.fulfill({ status: 200, headers: { ...cors, etag: '"fixture-etag"' } });
      }
      return route.fulfill({ status: 405, headers: cors });
    });

    await page.goto('/sjm/field', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Evidence & custody' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/An encrypted field report could not be matched to this mission/)).toHaveCount(0);
    await page.locator('input[aria-label="Choose mission evidence file"]').setInputFiles({
      name: 'arrival-proof.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    });
    await expect(page.getByText('Sonalit verified the stored object and recorded its SHA-256 integrity hash.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('arrival-proof.jpg')).toBeVisible();
    await expect(page.getByText(/Verified by Sonalit/)).toBeVisible();
    expect(objectUploaded).toBe(true);
    expect(recordVerified).toBe(true);
  });

});
