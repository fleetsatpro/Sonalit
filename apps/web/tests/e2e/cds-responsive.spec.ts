import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 'cds-responsive-e2e-admin',
  name: 'CDS Responsive E2E',
  email: 'cds-responsive@example.invalid',
  role: 'admin',
  org_id: 'org-cds-responsive-e2e',
};

async function prepareCds(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ profile }) => {
    localStorage.setItem('sonalit-auth', JSON.stringify({
      state: { user: profile },
      version: 0,
    }));
  }, { profile: user });

  // Navigation QA uses empty, explicitly synthetic responses. No operational
  // data is fabricated or written, and every request remains tenant-auth scoped.
  await page.route('**/api/v1/cds/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([]),
  }));
  await page.goto('/cds', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Container Management workspaces' })).toBeAttached({
    timeout: 20_000,
  });
}

test.describe('CDS responsive command shell', () => {
  test('uses a full labelled rail and proportionate workspace on desktop', async ({ page }) => {
    await prepareCds(page, 1440, 900);

    const rail = page.locator('.cds-navigation--desktop');
    const main = page.locator('.cds-main');
    await expect(rail).toBeVisible();
    await expect(page.getByText('Container Management', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.cds-nav-label').first()).toBeVisible();

    const railBox = await rail.boundingBox();
    const mainBox = await main.boundingBox();
    expect(railBox?.width).toBeGreaterThanOrEqual(250);
    expect(railBox?.width).toBeLessThanOrEqual(270);
    expect(mainBox?.width).toBeGreaterThan(1100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  });

  test('uses a compact icon rail on tablet without squeezing the workspace', async ({ page }) => {
    await prepareCds(page, 834, 1112);

    const rail = page.locator('.cds-navigation--desktop');
    const main = page.locator('.cds-main');
    await expect(rail).toBeVisible();
    await expect(page.locator('.cds-nav-label').first()).toBeHidden();

    const railBox = await rail.boundingBox();
    const mainBox = await main.boundingBox();
    expect(railBox?.width).toBeGreaterThanOrEqual(74);
    expect(railBox?.width).toBeLessThanOrEqual(82);
    expect(mainBox?.width).toBeGreaterThan(740);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(834);
  });

  test('replaces the desktop rail with an accessible drawer on phone and closes after navigation', async ({ page }) => {
    await prepareCds(page, 390, 844);

    await expect(page.locator('.cds-navigation--desktop')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open Container Management navigation' })).toBeVisible();
    const mainBox = await page.locator('.cds-main').boundingBox();
    expect(mainBox?.x).toBe(0);
    expect(mainBox?.width).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByRole('button', { name: 'Open Container Management navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Container Management navigation' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('navigation', { name: 'Container Management workspaces' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Container Register' })).toBeVisible();

    await drawer.getByRole('button', { name: 'Container Register' }).click();
    await expect(drawer).toBeHidden();
    await expect(page.locator('.cds-topbar-heading strong')).toHaveText('Container Register');
    await expect(page).toHaveURL(/#cds:containers$/);
  });

  test('closes the mobile navigation with Escape and restores focus to the menu control', async ({ page }) => {
    await prepareCds(page, 390, 844);

    const menu = page.getByRole('button', { name: 'Open Container Management navigation' });
    await menu.click();
    await expect(page.getByRole('dialog', { name: 'Container Management navigation' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Container Management navigation' })).toBeHidden();
    await expect(menu).toBeFocused();
  });
});
