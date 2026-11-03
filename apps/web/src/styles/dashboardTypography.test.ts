import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./dashboard.css', import.meta.url), 'utf8');

describe('operations UI typography foundation', () => {
  it('uses an inheritable baseline instead of a universal font override', () => {
    expect(css).toContain('html, body, #root {');
    expect(css).not.toMatch(/html,\s*body,\s*#root,\s*\*\s*\{/);
    expect(css).not.toMatch(/html\[data-theme\]\s+body\s+#root\s+\*\s*\{[^}]*font-(?:family|weight):[^}]*!important/s);
  });

  it('keeps a restrained hierarchy and purpose-built data typography', () => {
    expect(css).toContain(':where(h1, h2)');
    expect(css).toContain(':where(h3, h4)');
    expect(css).toContain('.d-font-mono');
    expect(css).toContain('font-variant-numeric: tabular-nums');
  });

  it('retains visible keyboard focus and respects reduced-motion preferences', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
