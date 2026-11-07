import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const EVENT_ID = 'e2e-intel-event-0001';
const EVENT = {
  id: EVENT_ID,
  title: '[E2E FIXTURE] Two reported fatalities in a targeted attack',
  summary: '[E2E FIXTURE] A test-only event used to verify impact, urgency and provenance presentation.',
  url: 'javascript:alert(1)',
  source_url: 'data:text/html,blocked',
  url: 'javascript:alert(1)',
  source_url: 'data:text/html,blocked',
  severity: 'high',
  status: 'fused',
  country_code: 'KE',
  source_count: 2,
  confidence: 65,
  last_seen_at: '2026-11-06T18:00:00.000Z',
  assessment: {
    security_relevance: 'security_relevant',
    severity_assessment: {
      impact: 'severe',
      urgency: 'immediate',
      basis: ['Persisted test rationale for the displayed assessment.'],
      caveat: 'E2E fixture only. Fused records are not independently verified incidents.',
    },
  },
};

const ALERT = {
  id: 'e2e-intel-alert-0001',
  title: '[E2E FIXTURE] Critical lead remains unverified',
  summary: '[E2E FIXTURE] A test-only public-signal observation; not operational intelligence.',
  severity: 'critical',
  category: 'armed_attack',
  country_code: 'KE',
  source_name: 'E2E source fixture',
  source_url: 'javascript:alert(1)',
  source_count: 2,
  confidence: 65,
  verification_state: 'unverified',
  last_seen_at: '2026-11-06T18:05:00.000Z',
  metadata: {
    security_relevance: 'security_relevant',
    source_reliability: 0.8,
    severity_assessment: {
      impact: 'catastrophic',
      urgency: 'immediate',
      basis: ['Test-only critical impact rationale.'],
      caveat: 'E2E fixture only. A public-signal lead is not a verified incident.',
    },
  },
};

const OBSERVATION = {
  id: 'e2e-intel-observation-0001',
  title: '[E2E FIXTURE] External source link validation',
  body: '[E2E FIXTURE] A test-only observation with an unsafe source URL.',
  url: 'javascript:alert(1)',
  source_name: 'E2E source fixture',
  country_code: 'KE',
  observed_at: '2026-11-06T18:10:00.000Z',
};
 
async function seedAdmin(page: Page, role: string = 'admin') {
  await page.addInitScript(({ user }: { user: object }) => {
    localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
  }, {
    user: {
      id: 'user-intel-e2e-admin',
      name: 'Intel Hub E2E Admin',
      email: 'intel-hub-e2e@example.invalid',
      role,
      org_id: 'org-intel-e2e',
    },
  });
}

async function stubIntelApi(page: Page, options: { alertsFailure?: boolean } = {}) {
  // Keep this browser-only workspace suite independent from the API server.
  // Explicit Intel Hub fixtures registered below take precedence over this fail-closed fallback.
  await page.route('**/api/**', async route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'E2E endpoint not stubbed' }),
  }));

  await page.route('**/api/v1/risk/intelligence/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    if (path === '/risk/intelligence/alerts') {
      if (options.alertsFailure) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'E2E upstream unavailable' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alerts: [ALERT] }) });
    }
    if (path === '/risk/intelligence/alerts/status') {
      return route.fulfill({
        status: options.alertsFailure ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: { sources: 2, latest_alert: ALERT.last_seen_at } }),
      });
    }
    if (path === '/risk/intelligence/observations') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ observations: [OBSERVATION] }) });
    }
    if (path === '/risk/intelligence/overview') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        events: [EVENT],
        summary: { events_in_window: 1, priority_events_in_window: 1, observations_in_window: 1, active_warnings: 0, open_gaps: 0 },
        generated_at: '2026-11-07T00:00:00.000Z',
      }) });
    }
    if (path === '/risk/intelligence/events') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [EVENT] }) });
    }
    if (path === '/risk/intelligence/events/' + EVENT_ID) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ event: { ...EVENT, evidence: [{ id: 'e2e-observation-0001', title: '[E2E FIXTURE] Source observation', source_name: 'E2E source fixture', url: 'javascript:alert(1)' }] } }),
      });
    }
    if (path === '/risk/intelligence/quality') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quality: { observations_30d: 1, sources_30d: 1, avg_credibility: 80, manipulation_flags: 0, open_gaps: 0 } }) });
    }
    if (path === '/risk/intelligence/countries') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ countries: [{ country_code: 'KE', events_24h: 1, confidence: 65, last_seen_at: EVENT.last_seen_at }] }) });
    }

    const keyByPath: Record<string, string> = {
      '/risk/intelligence/storylines': 'storylines',
      '/risk/intelligence/gaps': 'gaps',
      '/risk/intelligence/forecasts': 'forecasts',
      '/risk/intelligence/assessments': 'assessments',
      '/risk/intelligence/publications': 'publications',
      '/risk/intelligence/early-warnings': 'warnings',
      '/risk/intelligence/watchlists': 'watchlists',
      '/risk/intelligence/entities': 'entities',
      '/risk/intelligence/sources': 'sources',
      '/risk/intelligence/observations': 'observations',
      '/risk/intelligence/trajectories': 'trajectories',
      '/risk/intelligence/exposures': 'exposures',
      '/risk/intelligence/event-links': 'links',
      '/risk/intelligence/requirements': 'requirements',
    };
    const key = keyByPath[path];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(key ? { [key]: [] } : {}),
    });
  });
}

test.describe('Intel Hub restricted workspace', () => {
  test('renders the six-workspace shell and administrator boundary', async ({ page }, testInfo: TestInfo) => {
    await seedAdmin(page);
    await stubIntelApi(page);
    await page.goto('/intelligence');

    await expect(page.getByRole('heading', { name: 'INTEL HUB' })).toBeVisible();
    await expect(page.getByText('RESTRICTED WORKSPACE')).toBeVisible();
    await expect(page.getByText('ADMINISTRATOR ONLY')).toBeVisible();
    await expect(page.locator('.icw-rail .icw-nav-item')).toHaveCount(6);

    for (const label of ['COMMAND PICTURE', 'ANALYSIS WORKBENCH', 'INCIDENT FABRIC', 'NEWSROOM', 'COLLECTION CONTROL', 'PUBLICATIONS']) {
      await expect(page.locator('.icw-rail .icw-nav-item').filter({ hasText: label })).toBeVisible();
    }

    await testInfo.attach('intel-hub-desktop-shell', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });

  test('keeps persisted impact, urgency, confidence and rationale distinct in the event drawer', async ({ page }) => {
    await seedAdmin(page);
    await stubIntelApi(page);
    await page.goto('/intelligence?module=analysis');

    const row = page.locator('.icd-row').filter({ hasText: EVENT.title });
    await expect(row).toBeVisible();
    await row.click();

    const drawer = page.locator('.icd-drawer');
    await expect(drawer).toContainText('PRELIMINARY INCIDENT ASSESSMENT');
    await expect(drawer).toContainText('HIGH · NOT VERIFIED');
    await expect(drawer).toContainText('CLASSIFICATION');
    await expect(drawer).toContainText('SECURITY RELEVANT');
    await expect(drawer).toContainText('IMPACT');
    await expect(drawer).toContainText('SEVERE');
    await expect(drawer).toContainText('URGENCY');
    await expect(drawer).toContainText('IMMEDIATE');
    await expect(drawer).toContainText('CONFIDENCE');
    await expect(drawer).toContainText('65%');
    await expect(drawer).toContainText('INDEPENDENT SOURCES');
    await expect(drawer).toContainText('WHY THIS LEVEL');
    await expect(drawer).toContainText('Fused records are not independently verified incidents.');
    await expect(drawer.locator('a')).toHaveCount(0);
  });

  test('rejects unsafe source URLs from linked observations in the command picture', async ({ page }) => {
    await seedAdmin(page);
    await stubIntelApi(page);
    await page.goto('/intelligence?module=command');

    const row = page.locator('.icv-event-row').filter({ hasText: EVENT.title });
    await expect(row).toBeVisible();
    await row.click();

    const drawer = page.locator('.icv-drawer');
    await expect(drawer).toContainText('Linked observations');
    await expect(drawer.locator('a')).toHaveCount(0);
  });

  test('renders critical alerts as preliminary leads and exposes the verification caveat', async ({ page }) => {
    await seedAdmin(page);
    await stubIntelApi(page);
    await page.goto('/intelligence?module=alerts');

    const card = page.locator('.ia-alert').filter({ hasText: ALERT.title });
    await expect(card).toBeVisible();
    await expect(card).toContainText('CRITICAL · PRELIMINARY');
    await expect(card).toContainText('UNVERIFIED LEAD');
    await card.click();

    const drawer = page.locator('.ia-drawer');
    await expect(drawer).toContainText('CRITICAL · PRELIMINARY');
    await expect(drawer).toContainText('UNVERIFIED');
    await expect(drawer).toContainText('IMPACT');
    await expect(drawer).toContainText('CATASTROPHIC');
    await expect(drawer).toContainText('URGENCY');
    await expect(drawer).toContainText('IMMEDIATE');
    await expect(drawer).toContainText('WHY THIS LEVEL');
    await expect(drawer).toContainText('A public-signal lead is not a verified incident.');
  });

  test('rejects non-web source URLs in alert and newsroom evidence drawers', async ({ page }) => {
    await seedAdmin(page);
    await stubIntelApi(page);
    await page.goto('/intelligence?module=alerts');

    await page.locator('.ia-alert').filter({ hasText: ALERT.title }).click();
    await expect(page.locator('.ia-drawer a')).toHaveCount(0);

    await page.goto('/intelligence?module=newsroom');
    const observation = page.locator('.in-card').filter({ hasText: OBSERVATION.title });
    await expect(observation).toBeVisible();
    await observation.click();
    await expect(page.locator('.ic-evidence-drawer a')).toHaveCount(0);
  });

  test('does not represent an alert API failure as an empty incident window', async ({ page }) => {
    await seedAdmin(page);
    await stubIntelApi(page, { alertsFailure: true });
    await page.goto('/intelligence?module=alerts');

    const emptyState = page.locator('.ia-empty');
    await expect(emptyState).toContainText('ALERT QUERY FAILED — INCIDENT STATE UNKNOWN');
    await expect(emptyState).toContainText('An empty result is not evidence of zero incidents');
    await expect(emptyState).not.toContainText('NO KENYA SIGNALS RETURNED');
  });

  test('enforces the administrator-only route for non-admin users', async ({ page }) => {
    await seedAdmin(page, 'cpo');
    await page.goto('/intelligence');
    await page.waitForURL('**/home');
    await expect(page).toHaveURL(/\/home(?:\?|$)/);
  });

  test('keeps the mobile workbench within the viewport and its navigation operable', async ({ page }, testInfo: TestInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAdmin(page);
    await stubIntelApi(page);
    await page.goto('/intelligence?module=analysis');

    await expect(page.getByRole('heading', { name: 'ANALYSIS WORKBENCH' })).toBeVisible();
    const mobileNavigation = page.getByRole('navigation', { name: 'Intelligence workspaces' });
    await expect(mobileNavigation).toBeVisible();
    await expect(mobileNavigation.getByRole('button')).toHaveCount(6);

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 2);

    await testInfo.attach('intel-hub-mobile-analysis', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    const finalWorkspace = mobileNavigation.getByRole('button', { name: 'Publication desk' });
    await finalWorkspace.click();
    await expect(page.getByRole('heading', { name: 'SECURITY PUBLICATION DESK' })).toBeVisible();
    await expect(finalWorkspace).toHaveAttribute('aria-current', 'page');
  });

  test('has no serious or critical accessibility violations in the analysis workspace', async ({ page }, testInfo: TestInfo) => {
    await seedAdmin(page);
    await stubIntelApi(page);
    await page.goto('/intelligence?module=analysis');
    await expect(page.getByRole('heading', { name: 'ANALYSIS WORKBENCH' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = results.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
    const details = serious.map(item => ({
      id: item.id,
      impact: item.impact,
      description: item.description,
      nodes: item.nodes.map(node => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
        checks: node.any.filter(check => !check.passed).map(check => ({
          id: check.id,
          message: check.message,
          data: check.data,
          relatedNodes: check.relatedNodes?.map(related => ({ target: related.target, html: related.html })),
        })),
      })),
    }));
    await testInfo.attach('intel-hub-axe-serious-critical.json', {
      body: JSON.stringify(details, null, 2),
      contentType: 'application/json',
    });
    expect(details).toEqual([]);
  });
});
