import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders login form with platform title', async ({ page }) => {
    await expect(page).toHaveTitle(/Sonalit|Fleet/i);
    await expect(page.getByText(/logistics dashboard/i)).toBeVisible();
  });

  test('password mode shows email and password inputs', async ({ page }) => {
    // Switch to password mode
    await page.getByRole('button', { name: /password/i }).click();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test('shows validation error for invalid email', async ({ page }) => {
    await page.getByRole('button', { name: /password/i }).click();
    await page.getByLabel(/email/i).fill('not-an-email');
    await page.getByLabel(/password/i).fill('anypass');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/valid email/i)).toBeVisible();
  });

  test('redirects unauthenticated users to /login', async ({ page }) => {
    // All protected routes redirect to /login when no auth token
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('successful login navigates to dashboard', async ({ page }) => {
    // Mock successful login response
    await page.route('**/api/v1/auth/login', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJvcmdfaWQiOiJvcmctMSIsInJvbGUiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.fake',
          user: { id: 'user-1', name: 'Test Admin', email: 'admin@test.io', role: 'admin', org_id: 'org-1' },
        }),
      })
    );

    await page.getByRole('button', { name: /password/i }).click();
    await page.getByLabel(/email/i).fill('admin@test.io');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // After login, should not be on /login any more
    await expect(page).not.toHaveURL(/\/login/);
  });
});
