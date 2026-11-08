import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const dashboard = read('./CDSDashboard.tsx');
const gilded = read('./CDSGildedEdgeVisual.css');
const pages = read('./pages.tsx');

describe('CDS gilded edge visual contract', () => {
  it('loads after the existing cosmic and operational visual systems', () => {
    const cosmic = dashboard.indexOf("import './CDSCosmicVisual.css'");
    const polish = dashboard.indexOf("import './CDSOperationalPolish.css'");
    const gildedImport = dashboard.indexOf("import './CDSGildedEdgeVisual.css'");
    expect(cosmic).toBeGreaterThanOrEqual(0);
    expect(polish).toBeGreaterThan(cosmic);
    expect(gildedImport).toBeGreaterThan(polish);
  });

  it('uses gold as an edge treatment across the main and high-use operating surfaces', () => {
    expect(gilded).toContain('--cds-gold-foil');
    expect(gilded).toContain('--cds-gold-edge');
    expect(gilded).toContain('border-color: var(--cds-gold-edge) !important;');
    for (const surface of [
      '.cds-panel',
      '.cds-overview-heading',
      '.cds-overview-metric',
      '.cds-overview-panel',
      '.cds-booking-command',
      '.cds-booking-workbench',
      '.cds-booking-manifest-frame',
      '.cds-booking-group',
      '.cds-booking-record',
      '.cds-lock-device',
      '.cds-lock-battery-trend',
    ]) {
      expect(gilded).toContain(surface);
    }
  });

  it('keeps E-Lock cards compact while retaining every primary device evidence field', () => {
    expect(gilded).toContain('grid-template-columns: repeat(auto-fill, minmax(min(100%, 248px), 1fr));');
    expect(gilded).toContain('padding: 9px 10px 8px;');
    expect(gilded).toContain('min-height: 68px;');
    expect(gilded).toContain('grid-template-columns: minmax(0, 1.2fr) minmax(0, .8fr);');
    expect(gilded).toContain('@media (max-width: 680px)');
    for (const field of [
      'DEVICE /',
      'LockBatteryReadout row={row}',
      '<small>LINK</small>',
      '<small>HEARTBEAT</small>',
      '<small>TEMPERATURE</small>',
      'cds-lock-device__assignment',
      'LAST EVENT',
    ]) {
      expect(pages).toContain(field);
    }
  });

  it('keeps the dark surface, text contrast, semantic accents and control focus unchanged', () => {
    expect(gilded).not.toMatch(/(^|\\n)\\s*color\\s*:/);
    expect(gilded.match(/background\\s*:/g) ?? []).toHaveLength(1);
    expect(gilded).toContain('.cds-booking-command::after');
    expect(gilded).toContain('preserve the existing cyan focus ring');
  });

  it('adds no continuous animation, layout movement, filtering or motion-sensitive effect', () => {
    expect(gilded).not.toMatch(/animation\\s*:|@keyframes|transform\\s*:|filter\\s*:/);
    expect(gilded).not.toMatch(/background-position|will-change/);
    expect(gilded).toContain('@media (hover: hover) and (pointer: fine)');
  });
});
