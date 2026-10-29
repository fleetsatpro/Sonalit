import { expect, test, type Page } from '@playwright/test';

const JOURNEY_ID = 'journey-sjm-e2e-001';
const CLIENT_ID = 'client-sjm-e2e-001';
const CONVOY_ID = 'convoy-sjm-e2e-001';

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
  convoy_id: CONVOY_ID,
  convoy_name: 'SJM E2E Fixture Team',
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
  await page.route('**/api/v1/sjm/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === '/api/v1/sjm/clients') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: CLIENT_ID, name: 'SJM E2E Fixture Client', company: 'Test only' }] }),
      });
    }
    if (pathname === '/api/v1/sjm/convoys') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: CONVOY_ID, name: 'SJM E2E Fixture Team', status: 'planned' }] }),
      });
    }
    if (pathname === '/api/v1/sjm/journeys' && route.request().method() === 'GET') {
      const requestUrl = new URL(route.request().url());
      const offset = Number(requestUrl.searchParams.get('offset') || 0);
      const limit = Number(requestUrl.searchParams.get('limit') || 100);
      const summary = { ...journey };
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
    const journeyDetailMatch = pathname.match(/^\\/api\\/v1\\/sjm\\/journeys\\/([^/]+)$/);
    if (journeyDetailMatch && route.request().method() === 'GET') {
      const requestedId = decodeURIComponent(journeyDetailMatch[1]);
      if (requestedId === JOURNEY_ID) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: journey }),
        });
      }
      // The pagination E2E creates extra, synthetic register IDs. Return a
      // journey-shaped detail object for those IDs instead of { data: [] },
      // which is not a valid detail response and can crash the UI renderer.
      if (requestedId.startsWith(JOURNEY_ID + '-')) {
        const suffix = requestedId.slice(JOURNEY_ID.length + 1);
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
  // SJM lazily loads MapLibre and its mission workspace; allow for the cold CI Vite transform.
  test.describe.configure({ timeout: 120_000 });
  test('renders a real-evidence empty assessment state without horizontal overflow at target viewports', async ({ page }) => {
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
      await page.goto('/corridor/journeys', { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('heading', { name: /Secure journey operations/i })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Route has not been assessed', { exact: true })).toBeVisible();
      await expect(page.getByText('Not assessed', { exact: true }).first()).toBeVisible();

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
    }
  });

  test('workspace tabs remain operable and preserve evidence provenance on a narrow viewport', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/corridor/journeys', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    const tabs = page.getByRole('tablist', { name: 'Mission workspace views' });
    await expect(tabs).toBeVisible();

    await page.getByRole('tab', { name: 'Evidence ledger' }).click();
    await expect(page.getByRole('heading', { name: 'Journey events' })).toBeVisible();
    await expect(page.getByText('Manual stop confirmations', { exact: true })).toBeVisible();
    await expect(page.getByText('Not equivalent to a GPS proof', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Client reporting' }).click();
    await expect(page.getByRole('heading', { name: 'Generate a persisted report' })).toBeVisible();
    await expect(page.getByText(/No report is automatically emailed or distributed/)).toBeVisible();
  });

  test('team assignments stay out of the initial dispatch path until requested', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/corridor/journeys', { waitUntil: 'domcontentloaded' });

    const team = page.locator('details.sjm-team-admin');
    await expect(team).toBeVisible({ timeout: 15000 });
    await expect(team).not.toHaveAttribute('open', '');
    await expect(team.getByRole('heading', { name: 'Drivers, CPOs and meet-and-greet' })).toBeVisible();
    await expect(team.getByLabel('Active organisation user')).not.toBeVisible();

    await team.locator('summary').click();
    await expect(team).toHaveAttribute('open', '');
    await expect(team.getByLabel('Active organisation user')).toBeVisible();
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
    await page.goto('/corridor/missions', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('A previous mission is no longer in your authorised assignment list')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Synthetic fixture instructions only.')).not.toBeVisible();
    await expect(page.getByTestId('sjm-field-route-map')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).not.toBeVisible();
    await expect(page.getByText('Principal / booking reference: TEST-PRINCIPAL-001')).not.toBeVisible();
  });

  test('field route map shows locations without inventing an unassessed route', async ({ page }) => {
    await seedAuth(page);
    await stubFieldSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/corridor/missions', { waitUntil: 'domcontentloaded' });

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
    await page.goto('/corridor/missions', { waitUntil: 'domcontentloaded' });

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
    await page.goto('/corridor/missions', { waitUntil: 'domcontentloaded' });

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
    await page.goto('/corridor/missions', { waitUntil: 'domcontentloaded' });

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
        id: offset === 0 && index === 0 ? JOURNEY_ID : JOURNEY_ID + '-' + (offset + index),
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
    await page.goto('/corridor/journeys', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('176 matches')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Portfolio totals cover 176 authorised journeys', { exact: false })).toBeVisible();
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
    await page.getByLabel('Sort missions').selectOption('departure_asc');
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
    await page.getByRole('button', { name: 'Departure due ≤30m' }).click();
    await departureDueResponse;
    await expect.poll(() => requestedFilter).toBe('departure_due_30m');
    await expect.poll(() => requestedOffset).toBe(0);
    await expect(page.getByText('3 matches')).toBeVisible();
    await expect(page.getByRole('button', { name: /SJM-PAGE-0/ }).getByText('Departure due ≤30m')).toBeVisible();
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
    await page.goto('/corridor/journeys', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('5 of 8 checkpoints cleared')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('listitem', { name: 'Move current' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Arrival pending' })).toBeVisible();
  });

});
