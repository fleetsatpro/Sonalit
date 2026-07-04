import { test, expect } from '@playwright/test';

// The /login route renders the Sonalit ops-wall LoginPage
// (src/features/auth/login/LoginPage.tsx). The password tab is the default
// pane; email/password fields are labelled "EMAIL ADDRESS" / "PASSWORD".

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders login form with platform title', async ({ page }) => {
    await expect(page).toHaveTitle(/Sonalit|Fleet/i);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 8000 });
  });

  test('password mode shows email and password inputs', async ({ page }) => {
    // Password is the default tab — its pane is the only one mounted.
    await expect(page.getByRole('textbox', { name: /email address/i })).toBeVisible({ timeout: 8000 });
    // Role-based lookup skips the hidden forgot-password modal's email input.
    await expect(page.getByRole('textbox', { name: 'PASSWORD', exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('shows validation error for invalid email', async ({ page }) => {
    await page.getByRole('textbox', { name: /email address/i }).fill('not-an-email');
    await page.getByRole('textbox', { name: 'PASSWORD', exact: true }).fill('anypass');
    await page.getByRole('button', { name: /access dashboard/i }).click();
    // Scope to the sign-in console — the hidden reset-password modal has identical copy.
    await expect(page.getByLabel('Sign in').getByText(/valid email/i)).toBeVisible({ timeout: 8000 });
  });

  test('redirects unauthenticated users to /login', async ({ page }) => {
    // All protected routes redirect to /login when no auth token.
    // Cold Vite dev can spend >30s transforming the dashboard module graph
    // before the router's beforeLoad guard runs — give this test extra room.
    test.slow();
    // waitUntil 'commit': cold Vite dev transforms the whole dashboard module graph
    // before DOMContentLoaded, which can exceed the test timeout on slow runners.
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/login/, { timeout: 60000 });
  });

  test('successful login navigates to dashboard', async ({ page }) => {
    // Mock successful login response
    await page.route(url => url.toString().includes('/api/v1/auth/login'), route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmdfaWQiOiJvcmctMSIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.fake',
          user: { id: 'user-1', name: 'Test Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' },
        }),
      })
    );

    await page.getByRole('textbox', { name: /email address/i }).fill('admin@test.io');
    await page.getByRole('textbox', { name: 'PASSWORD', exact: true }).fill('password123');
    await page.getByRole('button', { name: /access dashboard/i }).click();

    // After login, should not be on /login any more
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });
});
