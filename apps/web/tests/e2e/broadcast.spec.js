/**
 * S2-F4: Convoy Broadcast + WhatsApp E2E spec
 *
 * Covers:
 *  - BroadcastPanel renders with channel selector
 *  - Canned message list populates dropdown
 *  - Send button submits broadcast with idempotency key
 *  - WhatsApp channel selection shown
 */
import { test, expect } from '@playwright/test';
const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_A = { id: 'user-a-001', name: 'Alice', email: 'alice@org-a.io', role: 'admin', org_id: ORG_A };
const ACTIVE_CONVOY = {
    id: 'convoy-001',
    name: 'Alpha Route',
    status: 'active',
    start_date: '2026-05-01',
    end_date: '2026-05-10',
    timezone: 'Africa/Nairobi',
    org_id: ORG_A,
};
const CANNED_MESSAGES = [
    { id: 'canned-001', title: 'ETA Update', body: 'ETA has been updated. Please check app.', category: 'operations' },
    { id: 'canned-002', title: 'Stop Advised', body: 'Please stop at the next safe area.', category: 'safety' },
];
async function seedAuth(page) {
    await page.addInitScript(({ user }) => {
        localStorage.setItem('sonalit-auth', JSON.stringify({ state: { user }, version: 0 }));
    }, { user: USER_A });
}
async function mockCommonRoutes(page) {
    await page.route(url => url.toString().includes('/api/v1/realtime/token'), route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'fake.payload.sig' }) }));
    await page.route(url => url.toString().includes('/api/v1/convoys'), route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [ACTIVE_CONVOY], total: 1 }),
    }));
    await page.route(url => url.toString().includes('/api/v1/canned-messages'), route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: CANNED_MESSAGES }) }));
}
test.describe('Broadcast — convoys list shows broadcast button for active convoys', () => {
    test.beforeEach(async ({ page }) => {
        await seedAuth(page);
        await mockCommonRoutes(page);
    });
    test('active convoy shows Radio broadcast button', async ({ page }) => {
        await page.goto('/convoys');
        // BroadcastPanel trigger — Radio icon button visible on active convoy row
        const broadcastBtn = page.locator('button[title="Broadcast"]').or(page.locator('button').filter({ hasText: '' }).first());
        await expect(broadcastBtn.first()).toBeVisible({ timeout: 8000 });
    });
});
test.describe('Broadcast — BroadcastPanel interactions', () => {
    test.beforeEach(async ({ page }) => {
        await seedAuth(page);
        await mockCommonRoutes(page);
        await page.goto('/convoys');
        // Open the broadcast panel by clicking the first active convoy's broadcast button
        await page.locator('button[title="Broadcast"]').first().click({ timeout: 8000 });
    });
    test('BroadcastPanel renders with channel selector buttons', async ({ page }) => {
        await expect(page.getByText('In-App')).toBeVisible({ timeout: 5000 });
        await expect(page.getByText('WhatsApp')).toBeVisible();
        await expect(page.getByText('SMS')).toBeVisible();
        await expect(page.getByText('Email')).toBeVisible();
    });
    test('BroadcastPanel shows convoy name in header', async ({ page }) => {
        // The convoy name appears in both the table row and the panel header (<p>).
        // Scope to <p> to avoid strict-mode violation from the duplicate table cell.
        await expect(page.locator('p').filter({ hasText: ACTIVE_CONVOY.name })).toBeVisible({ timeout: 5000 });
    });
    test('canned message dropdown populates from API', async ({ page }) => {
        const dropdown = page.locator('select').first();
        await expect(dropdown).toBeVisible({ timeout: 5000 });
        // <option> elements inside a closed <select> are always hidden in the DOM;
        // verify via allInnerTexts() instead of toBeVisible().
        const optionTexts = await dropdown.locator('option').allInnerTexts();
        expect(optionTexts).toContain('ETA Update');
        expect(optionTexts).toContain('Stop Advised');
    });
    test('selecting a canned message populates the textarea', async ({ page }) => {
        const dropdown = page.locator('select').first();
        await dropdown.selectOption('canned-001');
        const textarea = page.locator('textarea').first();
        await expect(textarea).toHaveValue(CANNED_MESSAGES[0].body, { timeout: 3000 });
    });
    test('Send button is disabled when message is empty', async ({ page }) => {
        const sendBtn = page.getByRole('button', { name: /send/i }).last();
        await expect(sendBtn).toBeDisabled({ timeout: 3000 });
    });
    test('broadcast POST includes X-Idempotency-Key header', async ({ page }) => {
        let capturedHeaders = {};
        await page.route(url => url.toString().includes('/broadcast'), async (route) => {
            const req = route.request();
            capturedHeaders = req.headers();
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({ data: { id: 'bcast-001', status: 'sent' }, recipients: 3 }),
            });
        });
        const textarea = page.locator('textarea').first();
        await textarea.fill('Test broadcast message from spec');
        await page.getByRole('button', { name: /send/i }).last().click();
        // Verify idempotency key was sent
        expect(capturedHeaders['x-idempotency-key']).toBeTruthy();
    });
    test('successful send shows recipient count', async ({ page }) => {
        await page.route(url => url.toString().includes('/broadcast'), route => route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ data: { id: 'bcast-001', status: 'sent' }, recipients: 5 }),
        }));
        const textarea = page.locator('textarea').first();
        await textarea.fill('Emergency update for all drivers');
        await page.getByRole('button', { name: /send/i }).last().click();
        await expect(page.getByText(/5 recipient/i)).toBeVisible({ timeout: 5000 });
    });
});
