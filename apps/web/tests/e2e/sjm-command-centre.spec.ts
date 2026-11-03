import { expect, test, type Page, type TestInfo } from '@playwright/test';

const JOURNEY_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function travelWorkspaceRouteMatches(url: URL): boolean {
  const path = '/api/v1/sjm/journeys/' + JOURNEY_ID + '/travel-workspace';
  return url.pathname === path || url.pathname.startsWith(path + '/');
}

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
  events: [
    {
      id: 'event-sjm-e2e-001',
      event_type: 'operator_note',
      summary: '[SYNTHETIC QA] Airport coordination note recorded',
      source: 'operator',
      created_at: '2026-10-29T09:10:00.000Z',
    },
  ],
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

type JourneyListFixture = { status: number; body: unknown };
type SjmApiStubOptions = {
  journeyListResponse?: (defaultBody: Record<string, unknown>, requestUrl: URL) => JourneyListFixture | null;
};

async function stubSjmApi(page: Page, options: SjmApiStubOptions = {}) {
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
      const defaultBody: Record<string, unknown> = {
        data: [summary],
        pagination: { limit, offset, total_count: 1, has_more: false },
        summary: { total: 1, active: 0, queue: 1, review: 0, awaiting_review: 1, arrival_verification: 0 },
      };
      const override = options.journeyListResponse?.(defaultBody, requestUrl) ?? null;
      return route.fulfill({
        status: override?.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(override?.body ?? defaultBody),
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
            report_template: { title: 'SJM E2E Fixture Report', version: 2, sections: ['summary','itinerary','stops','route_assessment','operational_events','telemetry_snapshot','traveller_dossier','flight_segments','daily_programme','travel_readiness','document_status'] },
            daily_reports_enabled: false,
            daily_report_local_time: '18:00',
            daily_report_scheduler_available: false,
            client: { id: CLIENT_ID, name: 'SJM E2E Fixture Client' },
          },
        }),
      });
    }
    if (travelWorkspaceRouteMatches(url) && route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {
          travellers: [{
            id: 'traveller-sjm-e2e-001',
            traveller_reference: 'TEST-PRINCIPAL-001',
            traveller_type: 'principal',
            display_name: 'Synthetic QA Principal',
            title: 'Ms',
            given_name: 'Synthetic',
            family_name: 'Principal',
            nationality: 'QA fixture',
            date_of_birth: '1994-04-18',
            email: 'synthetic-principal@example.invalid',
            phone: '+254700000001',
            emergency_contact_name: 'Synthetic QA Contact',
            emergency_contact_phone: '+254700000002',
          }],
          documents: [],
          readiness: {
            phase: 'departure',
            ready: false,
            blockers: [{ code: 'documents_pending', message: 'Synthetic QA fixture: no travel documents have been submitted.' }],
            warnings: [],
            counts: {
              traveller_count: 1,
              principal_traveller_count: 1,
              flight_segment_count: 1,
              programme_day_count: 1,
              timed_activity_count: 2,
              unassigned_activity_count: 0,
              required_programme_day_count: 1,
              cleared_document_count: 0,
              document_blocker_count: 0,
              expiring_document_count: 0,
              schedule_conflict_count: 0,
            },
          },
          flights: [{
            id: 'flight-sjm-e2e-001',
            sequence: 1,
            carrier: 'QA Airways',
            flight_number: 'QA 100',
            departure_airport: 'CDG',
            departure_airport_name: 'Paris Charles de Gaulle',
            departure_at: '2026-10-29T07:00:00.000Z',
            departure_timezone: 'Europe/Paris',
            arrival_airport: 'NBO',
            arrival_airport_name: 'Jomo Kenyatta International',
            arrival_at: '2026-10-29T08:30:00.000Z',
            arrival_timezone: 'Africa/Nairobi',
            status: 'scheduled',
            allowed_next_statuses: ['scheduled', 'boarding', 'departed', 'delayed', 'landed', 'cancelled', 'diverted'],
            traveller_id: 'traveller-sjm-e2e-001',
            traveller_display_name: 'Synthetic QA Principal',
            status_source: 'operator_entered',
            status_observed_at: '2026-10-28T17:00:00.000Z',
          }],
          days: [{
            id: 'day-sjm-e2e-001',
            journey_date: '2026-10-29',
            timezone: 'Africa/Nairobi',
            day_title: 'Synthetic QA · Arrival day',
            items: [
              {
                id: 'activity-sjm-e2e-001',
                sequence: 1,
                item_type: 'meet_and_greet',
                title: 'Meet & greet principal traveller',
                location_label: 'NBO Terminal 1A arrivals',
                planned_start_at: '2026-10-29T08:35:00.000Z',
                planned_end_at: '2026-10-29T08:55:00.000Z',
                execution_status: 'planned',
                actual_start_at: null,
                actual_end_at: null,
                traveller_display_name: 'TEST-PRINCIPAL-001',
                responsible_name: 'Fixture CPO',
                responsible_role: 'cpo',
              },
              {
                id: 'activity-sjm-e2e-002',
                sequence: 2,
                item_type: 'transfer',
                title: 'Controlled airport transfer',
                location_label: 'Nairobi CBD',
                planned_start_at: '2026-10-29T09:00:00.000Z',
                planned_end_at: '2026-10-29T09:45:00.000Z',
                execution_status: 'planned',
                actual_start_at: null,
                actual_end_at: null,
                traveller_display_name: 'TEST-PRINCIPAL-001',
                responsible_name: 'Fixture Driver',
                responsible_role: 'driver',
              },
            ],
          }],
        } }),
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

async function openFirstJourney(page: Page) {
  const firstJourney = page.getByTestId('sjm-register-list').getByRole('button').first();
  await expect(firstJourney).toBeVisible({ timeout: 15000 });
  await firstJourney.click();
  await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
}

async function openMoreJourneyViews(page: Page) {
  const more = page.locator('.sjm-workspace-more');
  if (!(await more.evaluate(element => (element as HTMLDetailsElement).open))) {
    await more.locator('summary').click();
  }
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

      await expect(page.getByRole('heading', { name: 'Journey operations' })).toBeVisible({ timeout: 15000 });
      const appClock = page.getByTestId('app-topbar-clock');
      await expect(appClock.getByText('LOCAL TIME', { exact: true })).toBeVisible();
      await expect(appClock.getByRole('time')).toBeVisible();
      await expect(appClock.getByText('LIVE', { exact: true })).toHaveCount(0);
      const sjmPageHeader = page.locator('main .sjm-console header.sjm-page-header');
      await expect(sjmPageHeader.getByText('SONALIT', { exact: true })).toBeVisible();
      await expect(sjmPageHeader.getByText('PROTECTIVE MOBILITY', { exact: true })).toBeVisible();
      await expect(sjmPageHeader.getByText('XD Live Surveillance', { exact: true })).toHaveCount(0);
      const queue = page.getByTestId('sjm-command-grid');
      await expect(queue).toHaveClass(/sjm-command-grid--queue/);
      const registerList = page.getByTestId('sjm-register-list');
      await expect(registerList).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toHaveCount(0);
      await testInfo.attach(`sjm-${viewport.label}-queue-first`, {
        body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
        contentType: 'image/png',
      });
      await registerList.getByRole('button').first().click();
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
      const commandGridDisplay = await commandGrid.evaluate(el => getComputedStyle(el).display);
      expect(commandGridDisplay, viewport.label + ': queue and detail shell must use CSS Grid').toBe('grid');
      const commandColumns = await commandGrid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(commandColumns, viewport.label + ': command grid column count').toBe(viewport.width >= 1440 ? 3 : viewport.width >= 1280 ? 2 : 1);
      await expect(commandGrid).toHaveClass(/sjm-command-grid--selected/);
      const workloadStrip = page.locator('.sjm-kpi-strip');
      if (viewport.width < 1280) {
        await expect(workloadStrip, viewport.label + ': workload summary belongs to the queue, not the focused journey view').toBeHidden();
      } else {
        await expect(workloadStrip).toBeVisible();
      }
      const operationsSections = operationsRail.locator('.sjm-live-ops-section');
      await expect(operationsRail).toBeVisible();
      await expect(operationsSections).toHaveCount(4);
      const missionWorkspaceBox = await page.locator('#sjm-mission-workspace').boundingBox();
      const operationsRailBox = await operationsRail.boundingBox();
      expect(missionWorkspaceBox, `${viewport.label}: mission workspace must render`).not.toBeNull();
      expect(operationsRailBox, `${viewport.label}: operations rail must render`).not.toBeNull();
      if (viewport.width >= 1440) {
        expect(operationsRailBox!.x, `${viewport.label}: operations rail must occupy the third desktop column`).toBeGreaterThan(missionWorkspaceBox!.x + missionWorkspaceBox!.width - 1);
      } else {
        expect(operationsRailBox!.y, `${viewport.label}: compact operations rail must follow the primary workspace`).toBeGreaterThanOrEqual(missionWorkspaceBox!.y);
      }
      const railSurface = await operationsRail.locator('.sjm-live-ops-rail').evaluate((el) => ({
        borderWidth: getComputedStyle(el).borderTopWidth,
        radius: getComputedStyle(el).borderTopLeftRadius,
        background: getComputedStyle(el).backgroundColor,
      }));
      expect(railSurface.borderWidth).toBe('1px');
      expect(railSurface.radius).toBe('12px');
      expect(railSurface.background).toBe('rgb(13, 20, 40)');
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
      expect(hierarchy.radius).toBe('12px');
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
      const missionBox = await selectedMissionHeading.boundingBox();
      expect(missionBox, `${viewport.label}: selected mission heading should render`).not.toBeNull();
      await expect(registerList).toContainText('Next action');
      await expect(registerList).toContainText('Team assignment not recorded');
      if (viewport.width < 1280) {
        await expect(registerHeading).toBeHidden();
        await expect(page.getByRole('button', { name: 'Back to journey register' })).toBeVisible();
      } else {
        await expect(registerHeading).toBeVisible();
        const registerBox = await registerHeading.boundingBox();
        expect(registerBox, `${viewport.label}: register heading should render`).not.toBeNull();
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

      // The previous component did not capture the newly integrated timeline.
      // Exercise it with an explicitly synthetic workspace fixture at mobile
      // and desktop widths, then attach the rendered panel for visual review.
      if (viewport.width === 390 || viewport.width === 1440) {
        await page.getByRole('tab', { name: 'Timeline' }).click();
        const timeline = page.getByTestId('sjm-unified-timeline');
        await expect(timeline).toBeVisible();
        await expect(timeline.getByText('QA Airways QA 100', { exact: true })).toBeVisible({ timeout: 10000 });
        await expect(timeline.getByText('Meet & greet principal traveller', { exact: true })).toBeVisible();
        await expect(timeline.getByText('Controlled airport transfer', { exact: true })).toBeVisible();
        await expect(timeline.getByText('[SYNTHETIC QA] Airport coordination note recorded', { exact: true })).toBeVisible();
        await expect(timeline.getByText('Status source · Operator entered', { exact: true })).toBeVisible();
        await expect(timeline.getByText('Planned activity · no execution timestamp recorded', { exact: true }).first()).toBeVisible();
        await expect(timeline.getByText('Planned stop · no confirmation recorded', { exact: true })).toBeVisible();

        const timelineEntries = timeline.locator('ol[aria-label="Chronological journey entries"] > li');
        await expect(timelineEntries).toHaveCount(5);
        await timeline.getByRole('button', { name: 'Travel programme' }).click();
        await expect(timeline.locator('ol[aria-label="Chronological journey entries"] > li')).toHaveCount(2);
        await timeline.getByRole('button', { name: 'All', exact: true }).click();
        await expect(timelineEntries).toHaveCount(5);

        const timelineDimensions = await timeline.evaluate(el => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }));
        expect(
          timelineDimensions.scrollWidth,
          viewport.label + ': timeline must not introduce horizontal overflow',
        ).toBeLessThanOrEqual(timelineDimensions.clientWidth);
        // The timeline lives inside the console's nested scroll surface.
        // Align its opening at the viewport top before capturing page-level
        // screenshots; element screenshots are clipped by that scroll surface.
        await timeline.evaluate(el => el.scrollIntoView({ block: 'start', inline: 'nearest' }));
        await testInfo.attach(`sjm-${viewport.label}-operations-timeline-top`, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
        await timelineEntries.last().scrollIntoViewIfNeeded();
        await testInfo.attach(`sjm-${viewport.label}-operations-timeline-lower`, {
          body: await page.screenshot({ animations: 'disabled' }),
          contentType: 'image/png',
        });
      }

    }
  });

  test('keeps the mobile register compact when the journey list is unavailable', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page, {
      journeyListResponse: () => ({
        status: 500,
        body: { error: 'internal_server_error', message: 'Internal server error' },
      }),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Journey register' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Journey register unavailable' })).toBeVisible({ timeout: 15_000 });
    const registerList = page.getByTestId('sjm-register-list');
    const registerBox = await registerList.boundingBox();
    expect(registerBox).not.toBeNull();
    expect(registerBox!.height, 'mobile error state should not retain a tall empty register body').toBeLessThan(180);
  });
  test('puts the journey register first when no journey is selected on narrow screens', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page, {
      journeyListResponse: () => ({
        status: 200,
        body: {
          data: [],
          pagination: { limit: 100, offset: 0, total_count: 0, has_more: false },
          summary: { total: 0, active: 0, queue: 0, review: 0, awaiting_review: 0, arrival_verification: 0 },
        },
      }),
    });

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Journey register' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Select a journey' })).toHaveCount(0);
      await expect(page.locator('.sjm-empty-workspace')).toBeHidden();
      await expect(page.getByTestId('sjm-command-grid')).toHaveClass(/sjm-command-grid--queue/);
      const register = await page.getByRole('heading', { name: 'Journey register' }).boundingBox();
      expect(register).not.toBeNull();

      const filterHeights = await page.locator('.sjm-register-filter').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
      expect(filterHeights.length).toBeGreaterThan(0);
      expect(Math.min(...filterHeights), 'journey filter chips must have comfortable touch targets').toBeGreaterThanOrEqual(44);
      const newJourney = page.getByRole('button', { name: 'New journey', exact: true }).first();
      expect(await newJourney.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        nestedMainCount: document.querySelectorAll('main main').length,
        consoleTag: document.querySelector('.sjm-console')?.tagName,
      }));
      expect(dimensions.document, 'no horizontal document overflow at ' + width + 'px').toBeLessThanOrEqual(width);
      expect(dimensions.body, 'no horizontal body overflow at ' + width + 'px').toBeLessThanOrEqual(width);
      expect(dimensions.nestedMainCount, 'SJM must not introduce a nested main landmark').toBe(0);
      expect(dimensions.consoleTag).toBe('DIV');
    }
  });
  test('retains the last successful register and KPIs after a refresh failure', async ({ page }) => {
    await seedAuth(page);
    // The app retries failed queries twice. Fail the initial request and both retries
    // so the query reaches its final error state before exercising manual recovery.
    let failedRefreshAttempts = 0;
    await stubSjmApi(page, {
      journeyListResponse: () => {
        if (failedRefreshAttempts <= 0) return null;
        failedRefreshAttempts -= 1;
        return {
          status: 500,
          body: { error: 'internal_server_error', message: 'Internal server error' },
        };
      },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    const register = page.getByTestId('sjm-register-list');
    await expect(register).toContainText('SJM-E2E-001');
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toHaveCount(0);
    await expect(page.getByTestId('sjm-command-grid')).toHaveClass(/sjm-command-grid--queue/);

    failedRefreshAttempts = 3;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const staleNotice = page.getByTestId('sjm-register-stale-notice');
    await expect(staleNotice).toBeVisible({ timeout: 15_000 });
    await expect(staleNotice).toContainText('last successful snapshot');
    await expect(register).toContainText('SJM-E2E-001');
    await expect(page.locator('[aria-label="Operations overview"]')).toHaveAttribute('data-stale', 'true');
    await expect(page.locator('[aria-label="Operations overview"]').getByText('Unavailable')).toHaveCount(0);

    await staleNotice.getByRole('button', { name: 'Retry refresh' }).click();
    await expect(page.getByTestId('sjm-register-stale-notice')).toHaveCount(0);
    await expect(page.getByText('Register refreshed', { exact: true })).toBeVisible();
    await expect(register).toContainText('SJM-E2E-001');
  });
  test('travel dossier exposes traveller registration, private document handling, flight legs and daily execution', async ({ page }, testInfo: TestInfo) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await openFirstJourney(page);

    await expect(page.getByRole('heading', { name: 'Journey operations' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });

    const travelShortcut = page.getByRole('button', { name: 'Open travel dossier' });
    await expect(travelShortcut).toBeVisible();
    await travelShortcut.click();
    const travelTab = page.getByRole('tab', { name: 'Traveller' });
    await expect(travelTab).toBeVisible();
    await expect(travelTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('sjm-command-grid')).toHaveClass(/sjm-command-grid--focused/);
    await expect(page.locator('aside.sjm-journey-ops-rail')).toBeHidden();

    const workspace = page.getByTestId('sjm-travel-workspace');
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole('heading', { name: 'People, documents & travel plan' })).toBeVisible();
    await expect(workspace.getByRole('heading', { name: 'Traveller register' })).toBeVisible();
    await expect(workspace.getByText('Synthetic QA Principal', { exact: true })).toBeVisible();

    const registerButton = workspace.getByRole('button', { name: 'Register traveller' }).first();
    await expect(registerButton).toBeVisible();
    await registerButton.click();
    await expect(workspace.getByText('Register a traveller', { exact: true })).toBeVisible();
    await expect(workspace.getByLabel('Given name *')).toBeVisible();
    await registerButton.click();

    await workspace.getByRole('button', { name: 'Attach document' }).click();
    await expect(workspace.getByText('PRIVATE TRAVEL DOCUMENT', { exact: true })).toBeVisible();
    await expect(workspace.getByText(/If private storage is not configured in this environment, upload is blocked/)).toBeVisible();

    await expect(workspace.getByRole('heading', { name: 'Flight segments' })).toBeVisible();
    await expect(workspace.getByText('QA Airways · QA 100', { exact: true })).toBeVisible();
    await expect(workspace.getByRole('heading', { name: 'Daily travel programme & execution' })).toBeVisible();
    await expect(workspace.getByRole('button', { name: /Synthetic QA · Arrival day/ })).toBeVisible();
    await expect(workspace.getByRole('heading', { name: 'Synthetic QA · Arrival day' })).toBeVisible();
    await expect(workspace.getByText('Meet & greet principal traveller', { exact: true })).toBeVisible();
    await expect(workspace.getByText('Controlled airport transfer', { exact: true })).toBeVisible();

    const dimensions = await workspace.evaluate(element => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.scrollWidth, 'travel dossier must not introduce horizontal overflow on a 390px viewport')
      .toBeLessThanOrEqual(dimensions.width);

    await workspace.evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await testInfo.attach('sjm-mobile-travel-dossier', {
      body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
      contentType: 'image/png',
    });

    await openMoreJourneyViews(page);
    await page.getByRole('tab', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { name: 'Report template' })).toBeVisible();
    await page.getByRole('button', { name: 'Configure profile' }).click();
    for (const sectionLabel of [
      'Traveller register',
      'Booked flight segments',
      'Day-by-day travel programme',
      'Traveller and departure readiness',
      'Aggregate travel-document status',
    ]) {
      await expect(page.getByLabel(sectionLabel)).toBeChecked();
    }
  });

  test('focused travel dossier uses two task columns on desktop and stacks cleanly on mobile', async ({ page }, testInfo: TestInfo) => {
    await seedAuth(page);
    await stubSjmApi(page);

    for (const viewport of [
      { width: 390, height: 844, columns: 1, label: 'mobile' },
      { width: 1440, height: 900, columns: 2, label: 'desktop' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
      await openFirstJourney(page);
      await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: 'Open travel dossier' }).click();

      const workspace = page.getByTestId('sjm-travel-workspace');
      await expect(workspace).toBeVisible();
      const taskGrid = workspace.getByTestId('sjm-travel-people-flights');
      const columns = await taskGrid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      expect(columns, viewport.label + ': traveller and flight work areas').toBe(viewport.columns);

      const dimensions = await workspace.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      expect(dimensions.scrollWidth, viewport.label + ': travel dossier must not overflow horizontally').toBeLessThanOrEqual(dimensions.width);

      if (viewport.label === 'desktop') {
        await testInfo.attach('sjm-desktop-focused-dossier', {
          body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
          contentType: 'image/png',
        });
      }
    }
  });

  test('unified operations timeline keeps record types and evidence classes separate', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID + '/travel-workspace', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {
        travellers: [],
        documents: [],
        flights: [{
          id: 'flight-timeline-001', sequence: 1, carrier: 'TEST AIR', flight_number: 'ZZ 100',
          departure_airport: 'LHR', departure_airport_name: 'London Heathrow',
          departure_at: '2026-10-31T07:00:00.000Z', departure_timezone: 'Europe/London',
          arrival_airport: 'NBO', arrival_airport_name: 'Jomo Kenyatta International',
          arrival_at: '2026-10-31T17:55:00.000Z', arrival_timezone: 'Africa/Nairobi',
          status: 'scheduled', status_source: 'operator_entered', status_observed_at: '2026-10-30T12:00:00.000Z',
        }],
        days: [{
          id: 'day-timeline-001', journey_date: '2026-10-31', timezone: 'Africa/Nairobi',
          day_title: 'Arrival and reception', items: [{
            id: 'item-timeline-001', sequence: 1, item_type: 'meet_and_greet',
            title: 'JKIA meet-and-greet', planned_start_at: '2026-10-31T18:10:00.000Z',
            planned_end_at: '2026-10-31T18:40:00.000Z', execution_status: 'planned',
            location_label: 'Terminal 1A arrivals', responsible_role: 'meet_greet',
          }],
        }],
        readiness: { phase: 'departure', ready: false, blockers: [], warnings: [], counts: {
          traveller_count: 0, principal_traveller_count: 0, flight_segment_count: 1,
          programme_day_count: 1, timed_activity_count: 1, unassigned_activity_count: 0,
          required_programme_day_count: 1, cleared_document_count: 0, document_blocker_count: 0,
          expiring_document_count: 0,
        }},
        access: { manager: true, user_id: 'user-sjm-e2e-admin', duty_roles: [] },
        provenance: { flight_status: 'Operator-entered unless a separately identified provider observation is returned' },
      } }),
    }));
    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {
        ...journey,
        stops: [{
          ...journey.stops[0], id: 'stop-timeline-001', sequence: 1, name: 'Terminal rendezvous',
          stop_status: 'reached', confirmed_at: '2026-10-31T18:05:00.000Z',
          confirmation_source: 'operator_confirmed',
        }],
        events: [{
          id: 'event-timeline-001', event_type: 'field_checkin',
          summary: 'Meet-and-greet team checked in', source: 'operator',
          created_at: '2026-10-31T18:06:00.000Z', detail: {},
        }],
      } }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await openFirstJourney(page);
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('tab', { name: 'Timeline' }).click();

    const timeline = page.getByTestId('sjm-unified-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline.getByRole('heading', { name: 'Unified journey timeline' })).toBeVisible();
    const flightEntry = timeline.getByRole('listitem').filter({ hasText: 'TEST AIR ZZ 100' });
    await expect(flightEntry).toHaveCount(1);
    await expect(flightEntry.getByText(/Europe\/London/)).toBeVisible();
    await expect(flightEntry.getByText(/End \/ arrival .*Africa\/Nairobi/)).toBeVisible();
    await expect(timeline.getByText('JKIA meet-and-greet', { exact: true })).toBeVisible();
    await expect(timeline.getByText(/London Heathrow · LHR departure/)).toBeVisible();
    await expect(timeline.getByText(/Jomo Kenyatta International · NBO arrival/)).toBeVisible();
    await expect(timeline.getByText('Status source · Operator entered', { exact: true })).toBeVisible();
    await expect(timeline.getByText('Stop 01 · Terminal rendezvous', { exact: true })).toBeVisible();
    await expect(timeline.getByText('Operator confirmed · not GPS proof', { exact: true })).toBeVisible();
    await expect(timeline.getByText('Meet-and-greet team checked in', { exact: true })).toBeVisible();
    await expect(timeline.getByText('Recorded by an authorised team member', { exact: true })).toBeVisible();
    await expect(timeline.getByText(/No routed road geometry is stored/)).toBeVisible();

    await timeline.getByRole('button', { name: 'Journey events' }).click();
    await expect(timeline.getByText('Meet-and-greet team checked in', { exact: true })).toBeVisible();
    await expect(timeline.getByText('TEST AIR ZZ 100', { exact: true })).toHaveCount(0);
    await timeline.getByRole('button', { name: 'All', exact: true }).click();
    await expect(timeline.getByText('TEST AIR ZZ 100', { exact: true })).toBeVisible();
  });

  test('mission resources are assigned to the journey directly', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await openFirstJourney(page);
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    const resourcesTab = page.getByRole('tab', { name: 'Team' });
    await expect(resourcesTab).toBeVisible();
    await resourcesTab.click();
    await expect(page.getByRole('heading', { name: 'Team & mission resources' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mission transport' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Field tracking & evidence sources' })).toBeVisible();
    await expect(page.getByText('No vehicles are assigned directly to this journey.')).toBeVisible();
    await expect(page.getByText('No Guardian devices are assigned directly to this journey.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Assign vehicles and devices' })).toBeVisible();
  });

  test('mobile journey selection opens a focused dossier and returns cleanly to the queue', async ({ page }) => {
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

    const workspace = page.locator('#sjm-mission-workspace');
    const secondMission = page.getByRole('button', { name: /SJM-E2E-002/ });
    await expect(secondMission).toBeVisible({ timeout: 15000 });
    await secondMission.click();
    const selectedHeading = page.getByRole('heading', { name: 'Second executive transfer' });
    await expect(selectedHeading).toBeVisible({ timeout: 15000 });
    await expect(selectedHeading).toBeFocused();
    await expect(page.getByRole('button', { name: 'Back to journey register' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to journey register' }).click();
    await expect(page.getByRole('heading', { name: 'Journey register' })).toBeVisible();
    await expect(workspace).toBeHidden();
    await expect(page.getByRole('button', { name: /SJM-E2E-002/ })).toBeVisible();
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
    await openFirstJourney(page);
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

  test('registers a traveller, records a flight-ready dossier and builds a dated daily programme before approval', async ({ page }, testInfo) => {
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
      readiness: {
        phase: string; ready: boolean;
        blockers: Array<{ code: string; message: string; missing_dates?: string[] }>;
        warnings: Array<{ code: string; message: string }>;
        counts: Record<string, number>;
      };
    } = {
      travellers: [], documents: [], flights: [], days: [],
      access: { manager: true, duty_roles: [] },
      provenance: {},
      readiness: {
        phase: 'departure', ready: false,
        blockers: [{ code: 'principal_traveller_missing', message: 'Register one principal traveller before route approval or departure release.' }],
        warnings: [],
        counts: { traveller_count: 0, principal_traveller_count: 0, flight_segment_count: 0, programme_day_count: 0, timed_activity_count: 0, unassigned_activity_count: 0, required_programme_day_count: 3, cleared_document_count: 0, document_blocker_count: 0, expiring_document_count: 0 },
      },
    };
    const travellerId = '30000000-0000-4000-8000-000000000001';
    const dayId = '30000000-0000-4000-8000-000000000002';
    const itemId = '30000000-0000-4000-8000-000000000003';
    const flightId = '30000000-0000-4000-8000-000000000004';
    const documentId = '30000000-0000-4000-8000-000000000005';
    const uploadedDocumentId = '30000000-0000-4000-8000-000000000009';
    const uploadedEvidenceId = '30000000-0000-4000-8000-00000000000a';
    const passportPdf = Buffer.from('%PDF-1.7\n% SJM browser upload fixture\n');

    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID + '/participants', async route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: [{ user_id: 'user-sjm-e2e-driver', duty_role: 'driver', user_name: 'Fixture Driver', is_primary: true, removed_at: null, account_status: 'active' }] }),
    }));
    await page.route(travelWorkspaceRouteMatches, async route => {
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
        workspace.readiness.counts.traveller_count = 1;
        workspace.readiness.counts.principal_traveller_count = 1;
        workspace.readiness.blockers = [{ code: 'airport_flight_details_incomplete', message: 'Every registered traveller on an airport movement needs a non-cancelled flight segment, or a shared segment covering the party.' }];
        workspace.documents.push({
          id: documentId, traveller_id: travellerId, document_type: 'passport',
          holder_name: 'Amina Example', review_status: 'REJECTED', review_note: 'Old scan',
          evidence_id: '30000000-0000-4000-8000-000000000006',
          file_name: 'superseded-passport.pdf', mime_type: 'application/pdf', size_bytes: 12000,
          expiry_state: 'current', expiry_date: '2030-01-01',
        });
        workspace.readiness.counts.document_blocker_count = 1;
        workspace.readiness.warnings = [];
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: traveller }) });
      }
      if (method === 'POST' && route.request().url().endsWith('/travellers/' + travellerId + '/documents/upload-url')) {
        const document = {
          id: uploadedDocumentId, traveller_id: travellerId, document_type: body.document_type,
          holder_name: body.holder_name, issuing_country: body.issuing_country,
          issue_date: body.issue_date, expiry_date: body.expiry_date,
          review_status: 'PENDING_REVIEW', review_note: null, evidence_id: uploadedEvidenceId,
          file_name: body.file_name, mime_type: body.mime_type, size_bytes: body.size_bytes,
          expiry_state: 'current',
        };
        workspace.documents.push(document);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: {
          id: uploadedDocumentId, review_status: 'UPLOAD_PENDING', evidence_id: uploadedEvidenceId,
          upload_url: 'https://test-account.r2.cloudflarestorage.com/sjm-private-bucket/' + uploadedEvidenceId + '.pdf',
          required_headers: {
            'Content-Type': 'application/pdf', 'If-None-Match': '*',
            'x-amz-meta-evidence-id': uploadedEvidenceId, 'x-amz-meta-journey-id': JOURNEY_ID,
          },
        } }) });
      }
      if (method === 'PATCH' && route.request().url().endsWith('/documents/' + uploadedDocumentId + '/review')) {
        const document = workspace.documents.find(value => value.id === uploadedDocumentId);
        if (!document) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'travel_document_not_found' }) });
        Object.assign(document, body, { review_status: body.review_status, review_note: body.review_note });
        workspace.readiness.counts.cleared_document_count = body.review_status === 'VERIFIED' ? 1 : 0;
        workspace.readiness.counts.document_blocker_count = body.review_status === 'VERIFIED' ? 0 : 1;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: document }) });
      }
      if (method === 'POST' && route.request().url().endsWith('/documents/' + documentId + '/archive')) {
        workspace.documents = workspace.documents.filter(document => document.id !== documentId);
        workspace.readiness.counts.document_blocker_count = 0;
        workspace.readiness.warnings = [{ code: 'no_travel_documents_recorded', message: 'No travel documents are registered. Confirm route-specific travel document requirements before departure.' }];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: documentId, archived: true, evidence_object_retained: true } }) });
      }
      if (method === 'POST' && route.request().url().endsWith('/flights')) {
        const flight = { id: flightId, sequence: 1, status: 'scheduled', allowed_next_statuses: ['scheduled','boarding','departed','delayed','cancelled','diverted'], status_source: 'operator_entered', traveller_display_name: body.traveller_id ? 'Amina Example' : null, ...body };
        workspace.flights.push(flight);
        workspace.readiness.counts.flight_segment_count = workspace.flights.length;
        workspace.readiness.blockers = [{ code: 'daily_programme_incomplete', message: 'Every local calendar day between planned departure and arrival needs a programme day with at least one timed activity.', missing_dates: ['2026-10-31','2026-11-01','2026-11-02'] }];
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: flight }) });
      }
      if (method === 'POST' && route.request().url().endsWith('/days/generate')) {
        const schedule = [
          { id: dayId, journey_date: '2026-10-31', timezone: 'Africa/Nairobi', day_title: 'Day 1 · Arrival and reception', items: [] },
          { id: '30000000-0000-4000-8000-000000000007', journey_date: '2026-11-01', timezone: 'Africa/Nairobi', day_title: 'Day 2 · Executive programme', items: [] },
          { id: '30000000-0000-4000-8000-000000000008', journey_date: '2026-11-02', timezone: 'Africa/Nairobi', day_title: 'Day 3 · Departure', items: [] },
        ];
        workspace.days.push(...schedule);
        workspace.readiness.counts.programme_day_count = schedule.length;
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { created_count: 3, existing_count: 0, total_days: 3, days: schedule.map(({ id, journey_date }) => ({ id, journey_date })) } }) });
      }
      if (method === 'POST' && route.request().url().endsWith('/days')) {
        const day = { id: dayId, ...body, timezone: 'Africa/Nairobi', items: [] };
        workspace.days.push(day);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: day }) });
      }
      if (method === 'PATCH' && route.request().url().endsWith('/days/' + dayId)) {
        const day = workspace.days.find(value => value.id === dayId);
        if (!day) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'itinerary_day_not_found' }) });
        Object.assign(day, body);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: day }) });
      }
      if (method === 'POST' && route.request().url().endsWith('/items')) {
        const day = workspace.days[0] as { items: Array<Record<string, unknown>> };
        const item = { id: itemId, sequence: 1, execution_status: 'planned', traveller_display_name: body.traveller_id ? 'Amina Example' : null, ...body };
        day.items.push(item);
        workspace.readiness.counts.timed_activity_count += 1;
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: item }) });
      }
      if (method === 'PATCH' && route.request().url().endsWith('/execution')) {
        const item = (workspace.days[0] as { items: Array<Record<string, unknown>> }).items[0];
        Object.assign(item, body);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: item }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected_travel_workspace_request' }) });
    });

    await page.route('https://test-account.r2.cloudflarestorage.com/**', async route => {
      const request = route.request();
      const origin = request.headers().origin || 'http://localhost';
      const corsHeaders = {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'PUT, OPTIONS',
        'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'content-type,if-none-match,x-amz-meta-evidence-id,x-amz-meta-journey-id',
        'access-control-max-age': '300',
        vary: 'Origin',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
      if (request.method() !== 'PUT') return route.fulfill({ status: 405, headers: corsHeaders });
      expect(request.headers()['content-type']).toBe('application/pdf');
      expect(request.headers()['if-none-match']).toBe('*');
      expect(request.headers()['x-amz-meta-evidence-id']).toBe(uploadedEvidenceId);
      expect(request.headers()['x-amz-meta-journey-id']).toBe(JOURNEY_ID);
      expect(request.postDataBuffer()).toEqual(passportPdf);
      return route.fulfill({ status: 200, headers: { ...corsHeaders, etag: '"sjm-e2e-upload"' } });
    });
    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID + '/evidence/' + uploadedEvidenceId + '/commit', async route => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {
        id: uploadedEvidenceId, status: 'VERIFIED', sha256: 'e2e-integrity-fixture',
      } }) });
    });

    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await openFirstJourney(page);
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('tab', { name: 'Traveller' }).click();
    await expect(page.getByRole('heading', { name: 'Traveller register' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Flight segments' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Daily travel programme & execution' })).toBeVisible();
    await expect(page.getByTestId('sjm-travel-readiness')).toBeVisible();
    await expect(page.getByText('Register one principal traveller before route approval or departure release.', { exact: true })).toBeVisible();
    await expect(page.locator('aside.sjm-journey-ops-rail')).toBeHidden();
    await expect(page.getByTestId('sjm-travel-readiness')).toContainText('Register one principal traveller before route approval or departure release.');

    await page.getByRole('button', { name: 'Register traveller' }).click();
    await page.getByLabel('Traveller reference *').fill('TRV-E2E-01');
    await page.getByLabel('Given name *').fill('Amina');
    await page.getByLabel('Family name *').fill('Example');
    await page.getByLabel('Nationality').fill('Kenyan');
    await page.getByLabel('Email').fill('amina@example.invalid');
    await page.getByRole('button', { name: 'Register traveller' }).last().click();
    await expect(page.getByText('Amina Example', { exact: true })).toBeVisible();
    await expect(page.getByText('Traveller profile registered to this journey.')).toBeVisible();
    await expect(page.getByText('Passport · superseded-passport.pdf')).toBeVisible();
    await page.getByRole('button', { name: 'Archive / supersede record' }).click();
    await page.getByLabel('Archive / supersession reason').fill('Obsolete scan replaced by the current verified passport copy.');
    await page.getByRole('button', { name: 'Confirm archive' }).click();
    await expect(page.getByText('Document record archived. The underlying evidence object has been retained under the SJM evidence-retention controls.')).toBeVisible();
    await expect(page.getByText('Passport · superseded-passport.pdf')).toHaveCount(0);

    await page.getByRole('button', { name: 'Attach document' }).click();
    await expect(page.getByText('PRIVATE TRAVEL DOCUMENT')).toBeVisible();
    const documentInput = page.locator('input[type="file"][accept="application/pdf,image/jpeg,image/png"]');
    await expect(documentInput).toBeVisible();
    await documentInput.setInputFiles({ name: 'current-passport.pdf', mimeType: 'application/pdf', buffer: passportPdf });
    await expect(page.getByText('Document stored privately and integrity-checked. It is now awaiting an authorised review.')).toBeVisible();
    await expect(page.getByText('Passport · current-passport.pdf')).toBeVisible();
    await page.getByLabel('Review rationale').fill('Passport holder and validity dates cross-checked against the traveller record.');
    await page.getByRole('button', { name: 'Verify document' }).click();
    await expect(page.getByText('Travel document review decision recorded.')).toBeVisible();

    await page.getByRole('button', { name: 'Add flight' }).click();
    await page.getByLabel('Traveller').selectOption(travellerId);
    await page.getByLabel('Airline / carrier *').fill('Kenya Airways');
    await page.getByLabel('Flight number *').fill('KQ 100');
    await page.getByLabel('Booking reference').fill('ABC123');
    await page.getByLabel('Departure airport code *', { exact: true }).fill('NBO');
    await page.getByLabel('Departure airport name', { exact: true }).fill('Jomo Kenyatta International Airport');
    await page.getByLabel('Departure local time *').fill('2026-11-01T10:00');
    await page.getByLabel('Departure IANA time zone *', { exact: true }).fill('Africa/Nairobi');
    await page.getByTestId('sjm-travel-workspace').getByLabel('Departure terminal', { exact: true }).fill('1A');
    await page.getByTestId('sjm-travel-workspace').getByLabel('Departure gate', { exact: true }).fill('12');
    await page.getByLabel('Arrival airport code *', { exact: true }).fill('CDG');
    await page.getByLabel('Arrival airport name', { exact: true }).fill('Paris Charles de Gaulle');
    await page.getByLabel('Arrival local time *').fill('2026-11-01T16:00');
    await page.getByLabel('Arrival IANA time zone *', { exact: true }).fill('Europe/Paris');
    await page.getByRole('button', { name: 'Add flight segment' }).click();
    await expect(page.getByText('Kenya Airways · KQ 100', { exact: true })).toBeVisible();
    await expect(page.getByText('Traveller · Amina Example')).toBeVisible();

    await page.getByRole('button', { name: 'Generate scheduled days' }).click();
    await expect(page.getByText('3 daily programme day(s) generated; 0 already existed. No activities or assignments were fabricated.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Day 1 · Arrival and reception' })).toBeVisible();
    await expect(page.getByText('Day 2 · Executive programme')).toBeVisible();
    await expect(page.getByText('Day 3 · Departure')).toBeVisible();

    await page.getByRole('button', { name: 'Edit day brief' }).click();
    await page.getByLabel('IANA timezone for activity times').fill('Europe/Paris');
    await page.getByRole('button', { name: 'Save day brief' }).click();
    await expect(page.getByText('2026-10-31 · Europe/Paris')).toBeVisible();

    await page.getByRole('button', { name: 'Add activity' }).click();
    await page.getByLabel('Activity title *').fill('Airport meet and greet');
    await page.getByLabel(/Planned start/).fill('2026-10-31T10:00');
    await page.getByLabel(/Planned end/).fill('2026-10-31T11:00');
    await page.getByLabel('Location / venue').fill('Jomo Kenyatta International Airport');
    await page.getByLabel('Traveller').selectOption(travellerId);
    await page.getByLabel('Latitude').fill('-1.3192');
    await page.getByLabel('Longitude').fill('36.9278');
    await page.getByLabel('Responsible team member').selectOption('user-sjm-e2e-driver');
    await page.getByLabel('Activity instructions').fill('Receive traveller at the agreed arrival point and coordinate handover.');
    await expect(page.getByLabel('Responsible team member')).toHaveValue('user-sjm-e2e-driver');
    await page.getByRole('button', { name: 'Add activity to day' }).click();
    await expect(page.getByText('Airport meet and greet', { exact: true })).toBeVisible();
    await expect(page.getByText('For traveller · Amina Example')).toBeVisible();
    await expect(page.getByText(/-1\.31920, 36\.92780/)).toBeVisible();

    await page.getByRole('button', { name: 'Edit day brief' }).click();
    await expect(page.getByLabel('IANA timezone for activity times')).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel edit' }).click();

    // A requested journey is still in the planning phase. Execution controls
    // must remain unavailable until the route has been approved and released.
    await expect(page.getByLabel('Execution note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);

    // Capture viewport-sized evidence at each major workflow section. Element-level
    // screenshots expand scroll containers and can produce misleading blank regions.
    const attachViewportAt = async (name: string, target: ReturnType<Page['getByRole']> | ReturnType<Page['getByTestId']>) => {
      await target.evaluate(element => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
      await testInfo.attach(name, {
        body: await page.screenshot({ animations: 'disabled', fullPage: false }),
        contentType: 'image/png',
      });
    };
    await attachViewportAt('sjm-travel-dossier-mobile-travellers', page.getByRole('heading', { name: 'Traveller register' }));
    await attachViewportAt('sjm-travel-dossier-mobile-flights', page.getByRole('heading', { name: 'Flight segments' }));
    await attachViewportAt('sjm-travel-dossier-mobile-programme', page.getByRole('heading', { name: 'Daily travel programme & execution' }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await attachViewportAt('sjm-travel-dossier-desktop', page.getByTestId('sjm-travel-workspace'));
  });

  test('records daily activity execution only after the journey has been released', async ({ page }) => {
    await seedAuth(page);
    await stubSjmApi(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const activity: Record<string, unknown> = {
      id: '40000000-0000-4000-8000-000000000001',
      sequence: 1,
      item_type: 'meet_and_greet',
      title: 'Airport meet and greet',
      description: 'Receive the traveller at the agreed arrival point.',
      location_label: 'Jomo Kenyatta International Airport',
      planned_start_at: '2026-10-31T07:00:00.000Z',
      planned_end_at: '2026-10-31T08:00:00.000Z',
      responsible_user_id: 'user-sjm-e2e-admin',
      responsible_role: 'dispatcher',
      execution_status: 'planned',
      actual_start_at: null,
      actual_end_at: null,
      execution_note: null,
    };
    const workspace = {
      travellers: [{ id: '40000000-0000-4000-8000-000000000002', traveller_reference: 'TRV-EXEC-01', traveller_type: 'principal', display_name: 'Amina Example' }],
      documents: [], flights: [],
      days: [{
        id: '40000000-0000-4000-8000-000000000003',
        journey_date: '2026-10-31', timezone: 'Africa/Nairobi',
        day_title: 'Arrival and reception', briefing: null, operational_notes: null,
        items: [activity],
      }],
      readiness: {
        phase: 'departure', ready: true, blockers: [], warnings: [],
        counts: {
          traveller_count: 1, principal_traveller_count: 1, flight_segment_count: 0,
          programme_day_count: 1, timed_activity_count: 1, unassigned_activity_count: 0,
          required_programme_day_count: 1, cleared_document_count: 0,
          document_blocker_count: 0, expiring_document_count: 0,
        },
      },
      access: { manager: true, user_id: 'user-sjm-e2e-admin', duty_roles: [] },
      provenance: {},
    };

    await page.route('**/api/v1/sjm/journeys/' + JOURNEY_ID, async route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { ...journey, status: 'in_progress', approved_at: '2026-10-31T06:00:00.000Z', started_at: '2026-10-31T06:30:00.000Z' } }),
    }));
    await page.route(travelWorkspaceRouteMatches, async route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: workspace }) });
      }
      if (route.request().method() === 'PATCH' && route.request().url().endsWith('/execution')) {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        Object.assign(activity, body);
        if (body.execution_status === 'in_progress') activity.actual_start_at = '2026-10-31T07:02:00.000Z';
        if (body.execution_status === 'completed') activity.actual_end_at = '2026-10-31T07:54:00.000Z';
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: activity }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected_travel_workspace_request' }) });
    });

    await page.goto('/sjm', { waitUntil: 'domcontentloaded' });
    await openFirstJourney(page);
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('tab', { name: 'Traveller' }).click();
    await expect(page.getByText('Airport meet and greet', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Execution note')).toBeVisible();

    await page.getByLabel('Execution note').fill('Assigned dispatcher confirmed the arrival team is at the agreed reception point.');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('Execution update recorded in the activity history.')).toBeVisible();
    await expect(page.getByTestId('sjm-travel-workspace').getByText('In progress', { exact: true })).toBeVisible();

    await page.getByLabel('Execution note').fill('Traveller received and identity matched against the approved movement brief.');
    await page.getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(page.getByText('Execution update recorded in the activity history.')).toBeVisible();
    await expect(page.getByTestId('sjm-travel-workspace').getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByText(/resolved/)).toBeVisible();
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
    await openFirstJourney(page);

    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    const tabs = page.getByRole('tablist', { name: 'Primary journey views' });
    const moreTabs = page.getByRole('tablist', { name: 'Additional journey views' });
    await expect(tabs).toBeVisible();
    await openMoreJourneyViews(page);
    await expect(moreTabs).toBeVisible();
    await page.getByRole('tab', { name: 'Evidence' }).click();
    await expect(page.getByRole('heading', { name: 'Journey events' })).toBeVisible();
    await expect(page.getByText('Manual stop confirmations', { exact: true })).toBeVisible();
    await expect(page.getByText('A manual confirmation does not prove GPS arrival.', { exact: true })).toBeVisible();

    await openMoreJourneyViews(page);
    await page.getByRole('tab', { name: 'Reports' }).click();
    await expect(page.getByRole('heading', { name: 'Generate report' })).toBeVisible();
    await expect(page.getByText(/Reports are downloaded here/)).toBeVisible();

    await openMoreJourneyViews(page);
    await page.getByRole('tab', { name: '3D airspace' }).click();
    await expect(page.getByRole('heading', { name: '3D airspace' })).toBeVisible();
    await expect(page.getByText('OpenSky access is not configured.')).toBeVisible();
    await expect(page.getByText('Plottable observations', { exact: true })).toBeVisible();
    await expect(page.getByText('OpenSky state vectors', { exact: true })).toBeVisible();
    await expect(page.getByText('ADSB.lol regional records', { exact: true })).toBeVisible();
    const adsbAttribution = page.locator('p').filter({ hasText: 'Source: ADSB.lol · ODbL 1.0.' });
    await expect(adsbAttribution).toContainText('educational aircraft-awareness source');
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
    await openFirstJourney(page);
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    await openMoreJourneyViews(page);
    await page.getByRole('tab', { name: '3D airspace' }).click();
    await expect.poll(() => page.locator('.sjm-workspace-more').evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
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
    await openFirstJourney(page);

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
    await openFirstJourney(page);
    await expect(page.getByRole('heading', { name: 'Airport arrival — controlled transfer' })).toBeVisible({ timeout: 15000 });
    const firstCard = page.getByRole('region', { name: 'Flight status' });
    await firstCard.getByRole('button', { name: 'Record flight status' }).click();
    await firstCard.getByLabel('Flight status').selectOption('delayed');
    await firstCard.getByLabel('Observation note').fill('First journey delay awaiting confirmation.');
    await firstCard.getByRole('button', { name: 'Save flight observation' }).click();
    await firstSaveStarted;

    await page.getByRole('button', { name: 'Back to journey register' }).click();
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
    await openFirstJourney(page);

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
      const totalCount = requestedFilter === 'overdue' ? 7 : requestedFilter === 'departure_due_30m' ? 3 : requestedFilter === 'arrival_verification' ? 11 : 176;
      const rowCount = Math.max(0, Math.min(offset === 0 ? 100 : 76, totalCount - offset));
      const data = Array.from({ length: rowCount }, (_, index) => ({
        ...summary,
        id: pagedJourneyId(offset + index),
        reference: 'SJM-PAGE-' + (offset + index),
        status: requestedFilter === 'arrival_verification' ? 'arrival_pending_verification' : summary.status,
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
    await page.getByLabel('Additional journey filters').selectOption('overdue');
    await overdueResponse;
    await expect.poll(() => requestedFilter).toBe('overdue');
    await expect.poll(() => requestedOffset).toBe(0);
    await expect(page.getByText('7 matches')).toBeVisible();
    await expect(page.getByText('Showing 1–7 of 7')).toBeVisible();
    await expect(page.getByRole('button', { name: /SJM-PAGE-0/ }).getByText('Departure overdue')).toBeVisible();

    const departureDueResponse = registerResponse('0', 'departure_due_30m', 'departure_asc');
    await page.getByLabel('Additional journey filters').selectOption('departure_due_30m');
    await departureDueResponse;
    await expect.poll(() => requestedFilter).toBe('departure_due_30m');
    await expect.poll(() => requestedOffset).toBe(0);
    await expect(page.getByText('3 matches')).toBeVisible();
    await expect(page.getByRole('button', { name: /SJM-PAGE-0/ }).getByText('Departing soon')).toBeVisible();

    const arrivalVerificationResponse = registerResponse('0', 'arrival_verification', 'departure_asc');
    await page.locator('.sjm-kpi-card.is-arrival').click();
    await arrivalVerificationResponse;
    await expect.poll(() => requestedFilter).toBe('arrival_verification');
    await expect(page.getByText('11 matches')).toBeVisible();
    await expect(page.locator('.sjm-kpi-card.is-arrival .sjm-kpi-card__value')).toHaveText('11');
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
    await openFirstJourney(page);
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
