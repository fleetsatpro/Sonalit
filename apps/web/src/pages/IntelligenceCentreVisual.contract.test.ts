import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const clarity = read('../styles/intelligence-centre-clarity.css');
const mainEntry = read('../main.tsx');

function hexToken(name: string): string {
  const match = clarity.match(new RegExp(name + ':\\s*(#[0-9a-f]{6});', 'i'));
  if (!match) throw new Error('Missing visual token: ' + name);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('Intel Hub crystalline clarity contract', () => {
  it('loads after the existing Intel Hub visual layers as the final cascade', () => {
    const craft = mainEntry.indexOf("import './styles/intelligence-centre-craft.css'");
    const clarityImport = mainEntry.indexOf("import './styles/intelligence-centre-clarity.css'");
    expect(craft).toBeGreaterThanOrEqual(0);
    expect(clarityImport).toBeGreaterThan(craft);
  });

  it('keeps normal operational text at an enhanced 7:1 contrast against the solid glass panel', () => {
    const panel = hexToken('--intel-crystal-panel');
    const readableTokens = [
      '--intel-crystal-text',
      '--intel-crystal-copy',
      '--intel-crystal-meta',
      '--intel-crystal-kicker',
      '--intel-crystal-critical',
      '--intel-crystal-high',
      '--intel-crystal-medium',
      '--intel-crystal-low',
    ];

    for (const name of readableTokens) {
      expect(contrastRatio(hexToken(name), panel), name + ' contrast').toBeGreaterThanOrEqual(7);
    }
  });

  it('uses opaque-enough glass surfaces without reducing information opacity', () => {
    expect(clarity).toContain('rgba(22, 38, 65, .97)');
    expect(clarity).toContain('backdrop-filter: blur(18px) saturate(145%)');
    expect(clarity).toContain('inset 0 1px rgba(255, 255, 255, .11)');
    expect(clarity).toContain('var(--intel-crystal-copy)');
    expect(clarity).not.toContain('opacity: .5;');
  });

  it('raises the legacy workbench typography and keeps dense records readable', () => {
    expect(clarity).toContain('.sonalit-intelligence-workspace .icd-root .icd-row > div b');
    expect(clarity).toContain('font-size: 13px;');
    expect(clarity).toContain('.sonalit-intelligence-workspace .icd-root .icd-row > div span');
    expect(clarity).toContain('font-size: 12px;');
    expect(clarity).toContain('.sonalit-intelligence-workspace .icd-root .icd-field-grid span');
    expect(clarity).toContain('font-size: 12.5px;');
  });

  it('keeps Newsroom event records distinct from toolbar actions and strengthens severity legibility', () => {
    expect(clarity).toContain('.sonalit-intelligence-workspace .intelligence-live .in-controls button');
    expect(clarity).not.toContain('.sonalit-intelligence-workspace .intelligence-live button {');
    expect(clarity).toContain('.sonalit-intelligence-workspace .intelligence-live .in-event b');
    expect(clarity).toContain('.sonalit-intelligence-workspace .ia-page .ia-severity-levels span');
    expect(clarity).toContain('.sonalit-intelligence-workspace .ia-page .ia-alert.critical .ia-alert-top b');
  });

  it('lifts dense metadata across all six workspaces above the legacy 6–10px label floor', () => {
    const requiredSelectors = [
      '.sonalit-intelligence-workspace .icv-root .icv-event-meta small',
      '.sonalit-intelligence-workspace .icv-root .icv-drawer-fields small',
      '.sonalit-intelligence-workspace .icd-root .icd-nav button b',
      '.sonalit-intelligence-workspace .icd-root .icd-row aside small',
      '.sonalit-intelligence-workspace .ia-page .ia-detail-badges span',
      '.sonalit-intelligence-workspace .ia-page .ia-drawer .field span',
      '.sonalit-intelligence-workspace .intelligence-live .in-card-top',
      '.sonalit-intelligence-workspace .intelligence-live .ic-evidence-grid small',
      '.sonalit-intelligence-workspace .ics-root .ics-state-pill',
      '.sonalit-intelligence-workspace .ics-root .ics-detail-grid small',
      '.sonalit-intelligence-workspace .ipd-root .ipd-handling-fields label',
    ];

    for (const selector of requiredSelectors) {
      expect(clarity, 'missing readability selector: ' + selector).toContain(selector);
    }

    expect(clarity).toContain('font-size: 11.5px;');
    expect(clarity).toContain('font-size: 12.5px;');
    expect(clarity).toContain('color: var(--intel-crystal-meta);');
    expect(clarity).toContain('color: var(--intel-crystal-copy);');
  });

  it('preserves keyboard focus and reduced-motion accessibility', () => {
    expect(clarity).toContain(':focus-visible');
    expect(clarity).toContain('outline: 2px solid var(--intel-crystal-focus)');
    expect(clarity).toContain('@media (prefers-reduced-motion: reduce)');
    expect(clarity).toContain('animation-duration: .01ms !important');
  });

  it('adds a high-contrast gilded-obsidian palette without weakening text contrast', () => {
    const panel = hexToken('--intel-crystal-panel');
    for (const name of ['--intel-gold', '--intel-gold-highlight', '--intel-gold-amber']) {
      expect(contrastRatio(hexToken(name), panel), name + ' contrast').toBeGreaterThanOrEqual(7);
    }
    expect(clarity).toContain('--intel-gold-edge-strong: rgba(255, 211, 105, .82);');
    expect(clarity).toContain('radial-gradient(ellipse at 13% 0%, rgba(255, 223, 151, .105), transparent 38%)');
    expect(clarity).toContain('outline: 2px solid var(--intel-gold)');
  });

  it('carries the metallic card treatment across all six Intelligence Centre workspaces', () => {
    const cardFamilies = [
      '.icv-root .icv-metric',
      '.icd-root .icd-kpi',
      '.ia-page .ia-alert',
      '.intelligence-live .in-card',
      '.ics-root .ics-source-card',
      '.ipd-root .ipd-card',
    ];
    for (const selector of cardFamilies) {
      expect(clarity, 'missing gilded card family: ' + selector).toContain(selector);
    }
    expect(clarity).toContain('border-color: var(--intel-gold-edge-strong);');
    expect(clarity).toContain('box-shadow:');
    expect(clarity).toContain('.icw-nav-item[aria-current="page"]');
  });

  it('keeps security severity tokens distinct from the gold brand accent', () => {
    expect(hexToken('--intel-crystal-critical')).toBe('#ff9ca7');
    expect(hexToken('--intel-crystal-high')).toBe('#ffc08a');
    expect(hexToken('--intel-crystal-medium')).toBe('#f2d989');
    expect(hexToken('--intel-crystal-low')).toBe('#79e7c5');
    expect(clarity).toContain('.icd-root .icd-sev.critical');
    expect(clarity).toContain('.ia-page .ia-severity-critical');
  });

});
