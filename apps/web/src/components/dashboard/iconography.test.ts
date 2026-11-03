import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const quickActions = readFileSync(new URL('./QuickActions.tsx', import.meta.url), 'utf8');
const compactEmpty = readFileSync(new URL('./CompactEmpty.tsx', import.meta.url), 'utf8');
const rail = readFileSync(new URL('../layout/Rail.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/dashboard.css', import.meta.url), 'utf8');

describe('premium operational iconography', () => {
  it('uses crisp vector icons instead of emoji in quick actions and empty states', () => {
    expect(quickActions).toContain('lucide-react');
    expect(compactEmpty).toContain('type LucideIcon');
    expect(quickActions).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(compactEmpty).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
  it('renders beveled, touch-clear vector icons in the navigation rail', () => {
    expect(rail).toContain('son-rail-icon');
    expect(css).toContain('.son-rail-icon svg');
    expect(css).toContain('inset 0 1px 0 rgba(255,255,255,.14)');
    expect(css).toContain('.son-icon-tile');
  });
});
