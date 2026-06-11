import { test, expect } from '@playwright/test';
const REPORTS = [
    { id: 'r1', title: 'Weekly Fleet Summary', generated_at: '2026-05-14T10:00:00Z', type: 'fleet', status: 'ready', url: null },
    { id: 'r2', title: 'Incident Report Q1', generated_at: '2026-04-01T09:00:00Z', type: 'incident', status: 'ready', url: null },
];
async function seedAuth(page) {
    await page.addInitScript(({ user }) => {
        localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
    }, { user: { id: 'user-1', name: 'Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' } });
}
test.describe('Reports page', () => {
    test.beforeEach(async ({ page }) => {
        await seedAuth(page);
        await page.route(url => url.toString().includes('/api/v1/realtime/token'), route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token: 'fake.payload.sig' }),
        }));
        await page.route(url => url.toString().includes('/api/v1/reports'), route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: REPORTS, meta: { total: 2, limit: 50, offset: 0 } }),
        }));
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
        await page.addInitScript(() => localStorage.removeItem('sonalit-auth'));
        await page.goto('/reports');
        await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    });
});
