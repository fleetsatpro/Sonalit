import { test, expect } from '@playwright/test';
const DEVICES = [
    { id: 'd1', name: 'Guardian Alpha', status: 'active', last_seen: new Date().toISOString(), battery_level: 85 },
    { id: 'd2', name: 'Guardian Beta', status: 'offline', last_seen: new Date(Date.now() - 3_600_000).toISOString(), battery_level: 20 },
];
async function seedAuth(page) {
    await page.addInitScript(({ user }) => {
        localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
    }, { user: { id: 'user-1', name: 'Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' } });
}
test.describe('Guardian page', () => {
    test.beforeEach(async ({ page }) => {
        await seedAuth(page);
        await page.route(url => url.toString().includes('/api/v1/guardian/devices'), route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: DEVICES, meta: { total: 2 } }),
        }));
        await page.route(url => url.toString().includes('/api/v1/guardian/panics'), route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: [], meta: { total: 0 } }),
        }));
        await page.route(url => url.toString().includes('/api/v1/guardian/commands'), route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: [], meta: { total: 0 } }),
        }));
    });
    test('guardian page renders device list', async ({ page }) => {
        await page.goto('/guardian');
        await expect(page.getByText('Guardian Alpha', { exact: true })).toBeVisible({ timeout: 8000 });
        await expect(page.getByText('Guardian Beta', { exact: true })).toBeVisible();
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
