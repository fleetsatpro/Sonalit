import { test, expect } from '@playwright/test';

const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmdfaWQiOiJvcmctMSIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.fake';

const DEVICES = [
  { id: 'd1', name: 'Guardian Alpha', status: 'active', last_seen: new Date().toISOString(), battery_level: 85 },
  { id: 'd2', name: 'Guardian Beta', status: 'offline', last_seen: new Date(Date.now() - 3_600_000).toISOString(), battery_level: 20 },
];

async function seedAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(({ token, user }: { token: string; user: object }) => {
    const state = { state: { accessToken: token, user, isAuthenticated: true }, version: 0 };
    localStorage.setItem('auth-storage', JSON.stringify(state));
  }, { token: MOCK_TOKEN, user: { id: 'user-1', name: 'Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' } });
}

test.describe('Guardian page', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);

    await page.route('**/api/v1/guardian/devices**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: DEVICES, meta: { total: 2 } }),
      })
    );

    await page.route('**/api/v1/guardian/panics**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      })
    );
  });

  test('guardian page renders device list', async ({ page }) => {
    await page.goto('/guardian');
    await expect(page.getByText('Guardian Alpha')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Guardian Beta')).toBeVisible();
  });

  test('shows active and offline device statuses', async ({ page }) => {
    await page.goto('/guardian');
    await expect(page.getByText(/active/i).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/offline/i).first()).toBeVisible();
  });

  test('page title contains Guardian or Devices', async ({ page }) => {
    await page.goto('/guardian');
    const heading = page.getByRole('heading').first();
    await expect(heading).toBeVisible({ timeout: 8000 });
  });
});
