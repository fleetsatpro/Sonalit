import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('./dashboard.css', import.meta.url), 'utf8');
const coverage = readFileSync(new URL('./theme-coverage.css', import.meta.url), 'utf8');
const store = readFileSync(new URL('../stores/ui.ts', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../pages/Settings.tsx', import.meta.url), 'utf8');
describe('high-visibility typography and dimensional icon settings', () => {
  it('exposes persisted, selectable strong and maximum text profiles', () => {
    expect(store).toContain("type TypographyProfile = 'strong' | 'maximum'");
    expect(store).toContain("name: 'sonalit-ui'");
    expect(store).toContain('typographyProfile: s.typographyProfile');
    expect(settings).toContain("setTypographyProfile('strong')");
    expect(settings).toContain("setTypographyProfile('maximum')");
    expect(settings).toContain('aria-checked={typographyProfile');
    expect(css).toContain(':root[data-typography="maximum"]');
    expect(css).toContain('font-weight: var(--son-readable-weight) !important');
    expect(css).toContain('font-weight: var(--son-heading-weight) !important');
  });
  it('renders dimensional vector icon tiles without emoji-dependent controls', () => {
    expect(settings).toContain('className="son-icon-tile"');
    expect(coverage).toContain('.son-icon-tile svg');
    expect(coverage).toContain('inset 0 1px 0');
    expect(coverage).toContain('son-type-profile-option:focus-visible');
  });
});
