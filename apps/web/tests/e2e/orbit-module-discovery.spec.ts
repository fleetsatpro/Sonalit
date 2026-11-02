import { expect, test } from '@playwright/test';

test('Orbit exposes Secure Journey Management in the Protective Mobility module group', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('sonalit-auth', JSON.stringify({
      state: {
        user: {
          id: 'orbit-sjm-discovery-admin',
          name: 'Orbit SJM Discovery',
          email: 'orbit-sjm-discovery@example.invalid',
          role: 'admin',
          org_id: 'org-orbit-sjm-discovery',
        },
      },
      version: 0,
    }));
  });
  await page.route('**/api/v1/**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'not_available_in_navigation_test' }),
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/home', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Protective Mobility', { exact: true })).toBeVisible({ timeout: 15000 });
  const sjm = page.getByRole('link', { name: /Secure Journey Management/ });
  const fieldOperations = page.getByRole('link', { name: /Field Operations/ });
  await expect(sjm).toBeVisible();
  await expect(sjm).toHaveAttribute('href', '/sjm');
  await expect(fieldOperations).toBeVisible();
  await expect(fieldOperations).toHaveAttribute('href', '/sjm/field');
});
