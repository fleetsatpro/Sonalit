import { test, expect } from '@playwright/test';

test.describe('Offline behaviour', () => {
  test('shows offline banner when network is offline', async ({ page, context }) => {
    await page.goto('/login');
    // Wait for login page to fully render so React has committed the render and
    // OfflineGuard's event listeners are wired before going offline.
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 8000 });
    // React's useEffect runs after the browser paints (post-commit). Give it time
    // to register the offline/online listeners before we simulate a network change.
    await page.waitForTimeout(500);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByText(/You.re offline/i)).toBeVisible({ timeout: 8000 });
  });

  test('hides offline banner when network is restored', async ({ page, context }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 8000 });
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
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(500);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible({ timeout: 8000 });
  });

  test('only explicit handover purges quarantine rows from the departing user', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 8000 });

    const outcome = await page.evaluate(async () => {
      const { db, purgeUserData } = await import('/src/lib/offline/db.ts');
      await db.open();
      try {
        await db.offline_quarantine.bulkPut([
          {
            id: 'outbox:e2e-user-a',
            source: 'outbox',
            ownerUserId: 'e2e-user-a',
            ownerOrgId: null,
            quarantinedAt: 1,
            reasonCode: 'missing_tenant_scope',
            record: { id: 'e2e-user-a', status: 'PENDING' },
          },
          {
            id: 'outbox:e2e-user-b',
            source: 'outbox',
            ownerUserId: 'e2e-user-b',
            ownerOrgId: null,
            quarantinedAt: 2,
            reasonCode: 'missing_tenant_scope',
            record: { id: 'e2e-user-b', status: 'PENDING' },
          },
          {
            id: 'entities:e2e-unknown-owner',
            source: 'entities',
            ownerUserId: null,
            ownerOrgId: null,
            quarantinedAt: 3,
            reasonCode: 'missing_tenant_scope',
            record: { key: 'legacy-unscoped' },
          },
        ]);

        const logoutCounts = await purgeUserData('e2e-user-a');
        const afterLogout = (await db.offline_quarantine.toArray()).map(row => row.id).sort();
        const handoverCounts = await purgeUserData('e2e-user-a', { keepUnsyncedOutbox: false });
        const afterHandover = (await db.offline_quarantine.toArray()).map(row => row.id).sort();

        return {
          logoutQuarantined: logoutCounts.quarantined,
          handoverQuarantined: handoverCounts.quarantined,
          afterLogout,
          afterHandover,
        };
      } finally {
        await db.delete();
      }
    });

    expect(outcome.logoutQuarantined).toBe(0);
    expect(outcome.afterLogout).toEqual([
      'entities:e2e-unknown-owner',
      'outbox:e2e-user-a',
      'outbox:e2e-user-b',
    ]);
    expect(outcome.handoverQuarantined).toBe(1);
    expect(outcome.afterHandover).toEqual([
      'entities:e2e-unknown-owner',
      'outbox:e2e-user-b',
    ]);
  });

});
