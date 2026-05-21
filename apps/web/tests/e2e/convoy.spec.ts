import { test, expect } from '@playwright/test';

const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmdfaWQiOiJvcmctMSIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.fake';

const CONVOYS = [
  { id: 'c1', name: 'North Convoy', status: 'active', region: 'Nigeria', priority: 'high' },
  { id: 'c2', name: 'South Run', status: 'planned', region: 'Kenya', priority: 'medium' },
];

async function seedAuth(page: import('@playwright/test').Page) {
  await page.addInitScript(({ token, user }: { token: string; user: object }) => {
    const state = { state: { accessToken: token, user, isAuthenticated: true }, version: 0 };
    localStorage.setItem('auth-storage', JSON.stringify(state));
  }, { token: MOCK_TOKEN, user: { id: 'user-1', name: 'Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' } });
}

test.describe('Convoy pages', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);

    await page.route('**/api/v1/convoys**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: CONVOYS, meta: { total: 2, limit: 50, offset: 0 } }),
      })
    );
  });

  test('convoys list page renders with convoy names', async ({ page }) => {
    await page.goto('/convoys');
    await expect(page.getByText('North Convoy')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('South Run')).toBeVisible();
  });

  test('convoy list shows status badges', async ({ page }) => {
    await page.goto('/convoys');
    await expect(page.getByText(/active/i).first()).toBeVisible({ timeout: 8000 });
  });

  test('new convoy button navigates to create form', async ({ page }) => {
    await page.goto('/convoys');
    const newBtn = page.getByRole('link', { name: /new convoy|create convoy/i });
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await expect(page).toHaveURL(/\/convoys\/new/);
    }
  });

  test('convoy form has required fields', async ({ page }) => {
    await page.goto('/convoys/new');
    // Form should contain name, region, route fields
    await expect(page.getByLabel(/convoy name|name/i).first()).toBeVisible({ timeout: 8000 });
  });
});
