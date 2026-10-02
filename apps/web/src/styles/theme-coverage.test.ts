import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SONALIT_THEMES } from './themes.js';

const coverageCss = readFileSync(new URL('./theme-coverage.css', import.meta.url), 'utf8');
const themeSystemCss = readFileSync(new URL('./theme-system.css', import.meta.url), 'utf8');
const mainTsx = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');

describe('Sonalit theme coverage layer', () => {
  it('declares browser chrome behaviour for every production theme', () => {
    for (const theme of SONALIT_THEMES) {
      expect(coverageCss).toContain(`html[data-theme="${theme.id}"]`);
    }
  });

  it('bridges every historically isolated application design system', () => {
    for (const root of [
      '.portal-root',
      '.sonalit-intelligence-shell',
      '.intelligence-centre',
      '.ics-root',
      '.ic2-root',
      '.icx-root',
      '.icd-root',
      '.ipd-root',
      '.intelligence-live',
      '.ia-page',
      '.spatial-command',
      '.spatial-surface',
      '.spatial-map-surface',
      '.rp',
      '.meridian',
      '.sonalit-login-root',
      '.accordion-gallery',
    ]) {
      expect(coverageCss).toContain(root);
    }
  });

  it('loads the coverage layer after feature styles and leaves intentional overlays alone', () => {
    expect(mainTsx.indexOf(`import './styles/theme-coverage.css';`)).toBeGreaterThan(
      mainTsx.indexOf(`import './styles/marketing.css';`),
    );
    expect(themeSystemCss).not.toContain('[class*="bg-black/"]');
  });

  it('covers legacy presentation-neutral utility families without remapping status colours', () => {
    for (const token of [
      'bg-slate-950',
      'bg-gray-900',
      'bg-neutral-800',
      'bg-ink-0',
      'text-slate-400',
      'text-neutral-300',
      'text-white',
      'border-white/10',
      'bg-violet-600',
      'bg-blue-600',
      'text-0',
      'text-2',
    ]) {
      expect(coverageCss).toContain(`[class~="${token}"]`);
    }
    expect(coverageCss).not.toContain('[class~="bg-red-600"]');
    expect(coverageCss).not.toContain('[class~="bg-green-600"]');
    expect(coverageCss).not.toContain('[class~="bg-amber-600"]');
  });
});
