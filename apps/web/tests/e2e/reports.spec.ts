import { test, expect } from '@playwright/test';

const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmdfaWQiOiJvcmctMSIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.fake';

const REPORTS = [
  { id: 'r1', title: 'Weekly Fleet Summary', generated_at: '2026-05-14T10:00:00Z', type: 'fleet', status: 'ready', url: null },
  { id: 'r2', title: 'Incident Report Q1',  generated_at: '2026-04-01T09:00:00Z', type: 'incident', status: 'ready', url: null },
];

async function seedAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(({ token, user }: { token: string; user: object }) => {
    const state = { state: { accessToken: token, user, isAuthenticated: true }, version: 0 };
    localStorage.setItem('auth-storage', JSON.stringify(state));
  }, { token: MOCK_TOKEN, user: { id: 'user-1', name: 'Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' } });
}

test.describe('Reports page', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);

    await page.route('**/api/v1/reports**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: REPORTS, meta: { total: 2, limit: 50, offset: 0 } }),
      })
    );
  });

  test('reports page renders report titles', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByText('Weekly Fleet Summary')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Incident Report Q1')).toBeVisible();
  });

  test('reports page has a heading', async ({ page }) => {
    await page.goto('/reports');
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 8000 });
  });

  test('unauthenticated user is redirected to login from /reports', async ({ page }) => {
    // Clear the auth seed
    await page.addInitScript(() => localStorage.removeItem('auth-storage'));
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });
});
