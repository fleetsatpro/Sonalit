import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const tailwind = readFileSync(new URL('../../tailwind.config.ts', import.meta.url), 'utf8');
const indexCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const coverage = readFileSync(new URL('./theme-coverage.css', import.meta.url), 'utf8');

describe('Sonalit typography design-system contract', () => {
  it('aligns Tailwind operations utilities with the self-hosted operations type system', () => {
    expect(tailwind).toContain("sans: ['Sora', 'system-ui', 'sans-serif']");
    expect(tailwind).toContain("mono: ['Space Mono', 'IBM Plex Mono', 'ui-monospace', 'monospace']");
    expect(tailwind).toContain("display: ['Sora', 'system-ui', 'sans-serif']");
    expect(indexCss).toContain("@import '@fontsource/sora/400.css';");
    expect(indexCss).toContain("@import '@fontsource/sora/800.css';");
    expect(indexCss).toContain("@import '@fontsource/space-mono/700.css';");
  });

  it('keeps partner portal typography isolated from operations utility aliases', () => {
    expect(coverage).toContain(':root[data-theme] .portal-root [class~="font-sans"]');
    expect(coverage).toContain('font-family: var(--p-sans) !important;');
    expect(coverage).toContain(':root[data-theme] .portal-root [class~="font-mono"]');
    expect(coverage).toContain('font-family: var(--p-mono) !important;');
    expect(indexCss).toContain("@import '@fontsource/ibm-plex-mono/700.css';");
  });

  it('does not reintroduce the universal !important font reset', () => {
    const dashboardCss = readFileSync(new URL('./dashboard.css', import.meta.url), 'utf8');
    expect(dashboardCss).not.toMatch(/html,\s*body,\s*#root,\s*\*\s*\{/);
    expect(dashboardCss).not.toMatch(/html\[data-theme\]\s+body\s+#root\s+\*\s*\{[^}]*font-family:[^}]*!important/s);
  });
});
