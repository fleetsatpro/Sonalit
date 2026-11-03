import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  { name: 'Login', path: '/login', requiresAuth: false },
];

test.describe('Accessibility — axe-core audit', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) has no critical a11y violations`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .disableRules(['color-contrast'])
        .analyze();

      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      expect(critical, `Critical/serious a11y violations on ${route.path}`).toHaveLength(0);
    });
  }
});
