import { test, expect } from '@playwright/test';
const CONVOYS = [
    { id: 'conv-1', reference: 'CONVOY-001', status: 'active', origin: 'Lagos', destination: 'Abuja' },
];
const TOKENS = [
    {
        id: 'tok-1',
        convoy_id: 'conv-1',
        cargo_owner_ref: 'ACME Corp',
        issued_at: '2026-05-29T08:00:00.000Z',
        expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
        last_used_at: null,
        revoked_at: null,
        issued_by_name: 'Admin User',
    },
];
async function seedAuth(page) {
    await page.addInitScript(({ user }) => {
        localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
    }, { user: { id: 'user-1', name: 'Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' } });
}
test.describe('Cargo Owner Portal page', () => {
    test.beforeEach(async ({ page }) => {
        await seedAuth(page);
        await page.route(url => url.toString().includes('/api/v1/realtime/token'), route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'fake.payload.sig' }) }));
        await page.route(url => url.toString().includes('/api/v1/convoys'), route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: CONVOYS, meta: { total: 1, limit: 200, offset: 0 } }),
        }));
        await page.route(url => url.toString().includes('/api/v1/portal/tokens'), route => {
            if (route.request().method() === 'GET') {
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ data: TOKENS }),
                });
            }
            else {
                route.continue();
            }
        });
    });
    test('renders the Cargo Portal heading', async ({ page }) => {
        await page.goto('/cargo-portal');
        await expect(page.getByRole('heading', { name: /Cargo Owner Portal/i })).toBeVisible({ timeout: 8000 });
    });
    test('shows existing token with cargo owner ref', async ({ page }) => {
        await page.goto('/cargo-portal');
        await expect(page.getByText('ACME Corp')).toBeVisible({ timeout: 8000 });
    });
    test('shows active status badge for non-revoked token', async ({ page }) => {
        await page.goto('/cargo-portal');
        await expect(page.getByText('Active')).toBeVisible({ timeout: 8000 });
    });
    test('shows Issue Token button', async ({ page }) => {
        await page.goto('/cargo-portal');
        await expect(page.getByRole('button', { name: /Issue Token/i })).toBeVisible({ timeout: 8000 });
    });
    test('opens issue token modal when button clicked', async ({ page }) => {
        await page.goto('/cargo-portal');
        await page.getByRole('button', { name: /Issue Token/i }).click();
        await expect(page.getByRole('heading', { name: /Issue Portal Token/i })).toBeVisible({ timeout: 5000 });
    });
    test('modal has convoy selector, ref input, and ttl input', async ({ page }) => {
        await page.goto('/cargo-portal');
        await page.getByRole('button', { name: /Issue Token/i }).click();
        await expect(page.getByRole('heading', { name: /Issue Portal Token/i })).toBeVisible({ timeout: 5000 });
        // cargo owner ref input — placeholder is unique to the modal
        await expect(page.getByPlaceholder(/ACME Corp/i)).toBeVisible();
        // TTL number input — min=1 max=168 only on this input
        await expect(page.locator('input[type="number"][min="1"][max="168"]')).toBeVisible();
    });
    test('modal can be cancelled', async ({ page }) => {
        await page.goto('/cargo-portal');
        await page.getByRole('button', { name: /Issue Token/i }).click();
        await page.getByRole('button', { name: /Cancel/i }).click();
        await expect(page.getByRole('heading', { name: /Issue Portal Token/i })).not.toBeVisible();
    });
    test('revoke button visible for active token', async ({ page }) => {
        await page.goto('/cargo-portal');
        await expect(page.getByRole('button', { name: /Revoke/i })).toBeVisible({ timeout: 8000 });
    });
    test('shows how it works section', async ({ page }) => {
        await page.goto('/cargo-portal');
        await expect(page.getByText(/How Portal Tokens Work/i)).toBeVisible({ timeout: 8000 });
    });
    test('shows revoked status for revoked token', async ({ page }) => {
        await page.route(url => url.toString().includes('/api/v1/portal/tokens'), route => {
            if (route.request().method() === 'GET') {
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        data: [{ ...TOKENS[0], revoked_at: '2026-05-29T12:00:00.000Z' }],
                    }),
                });
            }
            else {
                route.continue();
            }
        });
        await page.goto('/cargo-portal');
        await expect(page.getByText('Revoked')).toBeVisible({ timeout: 8000 });
    });
});
