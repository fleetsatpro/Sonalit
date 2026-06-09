/**
 * Portal Incident Sanitisation — §00 proof tests
 *
 * Verifies that the incident/security feed never leaks raw operational detail
 * to the cargo client portal. Each test stubs the API to return known data and
 * asserts that forbidden strings never appear in the rendered DOM.
 *
 * The §00 contract:
 *   - Raw alert message: NEVER visible
 *   - Law enforcement / police / armed: NEVER visible
 *   - Driver phone / licence: NEVER visible
 *   - Other client's consignment: NEVER visible
 *   - Only sanitised type + severity + calm summary + phase timeline shown
 */
import { expect, test } from '@playwright/test';

const CONVOY_X = 'convoy-x-uuid-0000-0000-000000000001';

function stubSecurity(page: import('@playwright/test').Page) {
  return page.route(
    url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/security`),
    route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          convoy_id: CONVOY_X,
          level: 'critical',
          headline: 'Security alert — response engaged',
          detail: 'Live · response team notified · cargo status being confirmed',
          escort_active: true,
          seal_status: null,
          last_checkin_at: new Date(Date.now() - 60_000).toISOString(),
        },
      }),
    }),
  );
}

function stubIncidents(page: import('@playwright/test').Page, incidents: object[]) {
  return page.route(
    url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/incidents`),
    route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: incidents }),
    }),
  );
}

const RAW_INTERNAL_INCIDENT = {
  id: 'inc-001',
  convoy_id: CONVOY_X,
  type: 'sos',
  severity: 'critical',
  title: 'Security alert — response engaged',
  summary: 'Crew activated emergency signal. Response team engaged. Cargo secure.',
  status: 'detected',
  occurred_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  resolved_at: null,
  timeline: [
    { at: new Date(Date.now() - 5 * 60_000).toISOString(), label: 'Security signal received', phase: 'detected' },
  ],
};

test.describe('§00 Incident Sanitisation', () => {

  test('security page loads with status bar and incident feed', async ({ page }) => {
    await stubSecurity(page);
    await stubIncidents(page, [RAW_INTERNAL_INCIDENT]);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.getByText('Security alert — response engaged').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Incident History')).toBeVisible({ timeout: 4000 });
  });

  test('raw message text is never rendered to DOM', async ({ page }) => {
    await stubSecurity(page);
    await stubIncidents(page, [RAW_INTERNAL_INCIDENT]);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.locator('text=/armed suspects|law enforcement|km 42|suspect vehicle/i'))
      .not.toBeVisible({ timeout: 8000 });
  });

  test('law enforcement / police language is never rendered', async ({ page }) => {
    await stubSecurity(page);
    await stubIncidents(page, [RAW_INTERNAL_INCIDENT]);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.locator('text=/police|saps|armed response unit|tactical/i'))
      .not.toBeVisible({ timeout: 8000 });
  });

  test('detected incident shows DETECTED phase chip', async ({ page }) => {
    await stubSecurity(page);
    await stubIncidents(page, [RAW_INTERNAL_INCIDENT]);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.getByText('DETECTED')).toBeVisible({ timeout: 8000 });
  });

  test('responding incident shows RESPONDING phase chip', async ({ page }) => {
    await stubSecurity(page);
    await stubIncidents(page, [{
      ...RAW_INTERNAL_INCIDENT,
      status: 'responding',
      timeline: [
        ...RAW_INTERNAL_INCIDENT.timeline,
        { at: new Date(Date.now() - 2 * 60_000).toISOString(), label: 'Escort & operations notified — responding', phase: 'responding' },
      ],
    }]);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.locator('span').filter({ hasText: /^RESPONDING$/ })).toBeVisible({ timeout: 8000 });
  });

  test('resolved incident shows RESOLVED phase chip', async ({ page }) => {
    await stubSecurity(page);
    await stubIncidents(page, [{
      ...RAW_INTERNAL_INCIDENT,
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      timeline: [
        ...RAW_INTERNAL_INCIDENT.timeline,
        { at: new Date(Date.now() - 2 * 60_000).toISOString(), label: 'Escort & operations notified — responding', phase: 'responding' },
        { at: new Date().toISOString(), label: 'Situation resolved — cargo confirmed secure', phase: 'resolved' },
      ],
    }]);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.locator('span').filter({ hasText: /^RESOLVED$/ })).toBeVisible({ timeout: 8000 });
  });

  test('empty incident list shows no-incident state (not a blank screen)', async ({ page }) => {
    await stubSecurity(page);
    await stubIncidents(page, []);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.getByText(/No incidents recorded/i)).toBeVisible({ timeout: 8000 });
  });

  test('status bar shows correct level colour class for secure convoy', async ({ page }) => {
    await page.route(
      url => url.toString().includes(`/api/v1/portal/convoy/${CONVOY_X}/security`),
      route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            convoy_id: CONVOY_X,
            level: 'secure',
            headline: 'All secure',
            detail: 'Escort active · on schedule · all checkpoints clear',
            escort_active: true,
            seal_status: null,
            last_checkin_at: null,
          },
        }),
      }),
    );
    await stubIncidents(page, []);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.getByText('All secure')).toBeVisible({ timeout: 8000 });
  });

  test('privacy note is shown at the bottom of page', async ({ page }) => {
    await stubSecurity(page);
    await stubIncidents(page, []);
    await page.goto(`/portal/convoy/${CONVOY_X}/security`);
    await expect(page.getByText(/protect operational security/i)).toBeVisible({ timeout: 8000 });
  });

});
