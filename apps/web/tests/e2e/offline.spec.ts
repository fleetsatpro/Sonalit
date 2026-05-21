import { test, expect } from '@playwright/test';

test.describe('Offline behaviour', () => {
  test('shows offline banner when network is offline', async ({ page, context }) => {
    await page.goto('/login');
    // Take the browser offline
    await context.setOffline(true);
    // OfflineGuard renders when navigator.onLine is false
    // Trigger a network event that the app listens to
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/offline/i)).toBeVisible({ timeout: 5000 });
  });

  test('hides offline banner when network is restored', async ({ page, context }) => {
    await page.goto('/login');
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/offline/i)).toBeVisible({ timeout: 5000 });

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByText(/offline/i)).not.toBeVisible({ timeout: 5000 });
  });

  test('shows retry button when offline', async ({ page, context }) => {
    await page.goto('/login');
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible({ timeout: 5000 });
  });
});
