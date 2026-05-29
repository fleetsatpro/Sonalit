import { test, expect } from '@playwright/test';

test.describe('Offline behaviour', () => {
  test('shows offline banner when network is offline', async ({ page, context }) => {
    await page.goto('/login');
    // Wait for login page to fully render so React has committed the render and
    // OfflineGuard's event listeners are wired before going offline.
    await expect(page.getByText(/logistics dashboard/i)).toBeVisible({ timeout: 8000 });
    // React's useEffect runs after the browser paints (post-commit). Give it time
    // to register the offline/online listeners before we simulate a network change.
    await page.waitForTimeout(500);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/You.re offline/i)).toBeVisible({ timeout: 8000 });
  });

  test('hides offline banner when network is restored', async ({ page, context }) => {
    await page.goto('/login');
    await expect(page.getByText(/logistics dashboard/i)).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(500);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/You.re offline/i)).toBeVisible({ timeout: 8000 });

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText(/You.re offline/i)).not.toBeVisible({ timeout: 5000 });
  });

  test('shows retry button when offline', async ({ page, context }) => {
    await page.goto('/login');
    await expect(page.getByText(/logistics dashboard/i)).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(500);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible({ timeout: 8000 });
  });
});
