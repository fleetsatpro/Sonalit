import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const quickActions = readFileSync(new URL('./QuickActions.tsx', import.meta.url), 'utf8');
const compactEmpty = readFileSync(new URL('./CompactEmpty.tsx', import.meta.url), 'utf8');
const rail = readFileSync(new URL('../layout/Rail.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/dashboard.css', import.meta.url), 'utf8');
const cdsRail = readFileSync(new URL('../../../../../container-delivery-system/src/components/layout/Rail.tsx', import.meta.url), 'utf8');
const cdsCss = readFileSync(new URL('../../../../../container-delivery-system/src/index.css', import.meta.url), 'utf8');

describe('premium operational iconography', () => {
  it('uses crisp vector icons instead of emoji in quick actions and empty states', () => {
    expect(quickActions).toContain('lucide-react');
    expect(compactEmpty).toContain('type LucideIcon');
    expect(quickActions).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(compactEmpty).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
  it('uses high-definition pictorial artwork and motion in both navigation rails', () => {
    expect(rail).toContain('son-rail-icon');
    expect(rail).toContain('son-rail-art');
    expect(rail).toContain('sonalit-nav-sprite.svg#');
    expect(rail).not.toContain('LucideIcon');
    expect(css).toContain('.son-rail-icon .son-rail-art');
    expect(css).toContain('son-nav-art-breathe');
    expect(cdsRail).toContain('NavArtwork');
    expect(cdsRail).toContain('sonalit-nav-sprite.svg#');
    expect(cdsRail).not.toContain('item.icon');
    expect(cdsRail).not.toContain('>S</div>');
    expect(cdsCss).toContain('.cds-nav-art');
    expect(cdsCss).toContain('cds-nav-art-breathe');
    expect(css).toContain('.son-icon-tile');
  });
});
