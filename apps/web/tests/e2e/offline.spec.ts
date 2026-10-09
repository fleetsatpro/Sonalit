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
      const modulePath: string = '/src/lib/offline/db.ts';
      const { db, purgeUserData } = await import(modulePath);
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


  test('durably stores a voice-note Blob across database close and purges it only on handover', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 8000 });

    const outcome = await page.evaluate(async () => {
      const dbModulePath: string = '/src/lib/offline/db.ts';
      const mediaModulePath: string = '/src/lib/offline/mediaOutbox.ts';
      const { db, purgeUserData } = await import(dbModulePath);
      const { enqueueVoiceNote, getMediaUploadEntry, getMediaQueueCounts } = await import(mediaModulePath);
      await db.open();
      try {
        const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/webm' });
        const entry = await enqueueVoiceNote({
          ownerUserId: 'media-user-a',
          ownerOrgId: 'media-org-a',
          parentType: 'incident',
          parentId: '33333333-3333-4333-8333-333333333333',
          blob,
          mimeType: 'audio/webm',
          durationSec: 5,
        });
        const now = Date.now();
        await db.outbox.put({
          id: '55555555-5555-4555-8555-555555555555',
          localSequence: 7,
          type: 'cds_container.status_change',
          transport: 'sync',
          entityType: 'cds_container',
          entityId: 'container-a',
          label: 'Container status change',
          priority: 3,
          payload: { status: 'arrived' },
          dependsOn: [],
          status: 'FAILED_PERMANENT',
          attempts: 5,
          nextAttemptAt: Number.MAX_SAFE_INTEGER,
          lastAttemptAt: now,
          clientCreatedAt: now,
          schemaVersion: 1,
          ownerUserId: 'media-user-a',
          ownerOrgId: 'media-org-a',
          lastErrorCode: 'validation_failed',
          lastErrorMessage: 'Needs operator review',
          serverResult: null,
          acknowledgedAt: null,
        });
        await db.gps_buffer.put({
          id: '66666666-6666-4666-8666-666666666666',
          vehicleId: 'vehicle-a',
          tripId: null,
          lat: -1.2864,
          lng: 36.8172,
          accuracy: 10,
          speed: 0,
          heading: 0,
          altitude: null,
          deviceTime: new Date(now).toISOString(),
          sequence: 8,
          ownerUserId: 'media-user-a',
          ownerOrgId: 'media-org-a',
        });
        await db.conflicts.put({
          id: '77777777-7777-4777-8777-777777777777',
          operationId: '55555555-5555-4555-8555-555555555555',
          entityType: 'cds_container',
          entityId: 'container-a',
          label: 'Container status change',
          localPayload: { status: 'arrived' },
          serverSnapshot: { status: 'in_yard' },
          reason: 'Server revision changed',
          detectedAt: now,
          ownerUserId: 'media-user-a',
          ownerOrgId: 'media-org-a',
        });

        const initialCounts = await getMediaQueueCounts('media-user-a', 'media-org-a');

        await db.close();
        await db.open();
        const restored = await getMediaUploadEntry(entry.id, 'media-user-a', 'media-org-a');
        const logout = await purgeUserData('media-user-a');
        const afterLogout = await getMediaUploadEntry(entry.id, 'media-user-a', 'media-org-a');
        const outboxAfterLogout = await db.outbox.get('55555555-5555-4555-8555-555555555555');
        const gpsAfterLogout = await db.gps_buffer.get('66666666-6666-4666-8666-666666666666');
        const conflictAfterLogout = await db.conflicts.get('77777777-7777-4777-8777-777777777777');
        const handover = await purgeUserData('media-user-a', { keepUnsyncedOutbox: false });
        const afterHandover = await getMediaUploadEntry(entry.id, 'media-user-a', 'media-org-a');

        return {
          id: entry.id,
          initialPending: initialCounts.pending,
          initialPendingBytes: initialCounts.pendingBytes,
          restoredStatus: restored?.status ?? null,
          restoredSize: restored?.blob?.size ?? null,
          logoutMediaCount: logout.media,
          remainsAfterLogout: Boolean(afterLogout?.blob),
          outboxStatusAfterLogout: outboxAfterLogout?.status ?? null,
          gpsAfterLogout: Boolean(gpsAfterLogout),
          conflictAfterLogout: Boolean(conflictAfterLogout),
          handoverMediaCount: handover.media,
          handoverGpsCount: handover.gps,
          handoverConflictCount: handover.conflicts,
          remainsAfterHandover: Boolean(afterHandover),
          outboxAfterHandover: Boolean(await db.outbox.get('55555555-5555-4555-8555-555555555555')),
          gpsAfterHandover: Boolean(await db.gps_buffer.get('66666666-6666-4666-8666-666666666666')),
          conflictAfterHandover: Boolean(await db.conflicts.get('77777777-7777-4777-8777-777777777777')),
        };
      } finally {
        await db.delete();
      }
    });

    expect(outcome.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(outcome.initialPending).toBe(1);
    expect(outcome.initialPendingBytes).toBe(5);
    expect(outcome.restoredStatus).toBe('PENDING');
    expect(outcome.restoredSize).toBe(5);
    expect(outcome.logoutMediaCount).toBe(0);
    expect(outcome.remainsAfterLogout).toBe(true);
    expect(outcome.outboxStatusAfterLogout).toBe('FAILED_PERMANENT');
    expect(outcome.gpsAfterLogout).toBe(true);
    expect(outcome.conflictAfterLogout).toBe(true);
    expect(outcome.handoverMediaCount).toBe(1);
    expect(outcome.handoverGpsCount).toBe(1);
    expect(outcome.handoverConflictCount).toBe(1);
    expect(outcome.remainsAfterHandover).toBe(false);
    expect(outcome.outboxAfterHandover).toBe(false);
    expect(outcome.gpsAfterHandover).toBe(false);
    expect(outcome.conflictAfterHandover).toBe(false);
  });

});
