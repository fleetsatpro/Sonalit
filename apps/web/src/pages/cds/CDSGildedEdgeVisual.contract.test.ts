import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const dashboard = read('./CDSDashboard.tsx');
const gilded = read('./CDSGildedEdgeVisual.css');
const polish = read('./CDSOperationalPolish.css');
const pages = read('./pages.tsx');

describe('CDS gilded edge visual contract', () => {
  it('loads after the existing cosmic and operational visual systems', () => {
    const cosmic = dashboard.indexOf("import './CDSCosmicVisual.css'");
    const polishImport = dashboard.indexOf("import './CDSOperationalPolish.css'");
    const gildedImport = dashboard.indexOf("import './CDSGildedEdgeVisual.css'");
    expect(cosmic).toBeGreaterThanOrEqual(0);
    expect(polishImport).toBeGreaterThan(cosmic);
    expect(gildedImport).toBeGreaterThan(polishImport);
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
      '.cds-lock-register__hero',
      '.cds-lock-register__summary > div',
      '.cds-lock-register__workspace',
      '.cds-lock-dossier__hero',
      '.cds-lock-battery-trend',
    ]) {
      expect(gilded).toContain(surface);
    }
  });

  it('uses a dense responsive E-Lock register while retaining primary device evidence', () => {
    expect(polish).toContain('.cds-lock-register__table { width: 100%; min-width: 1030px;');
    expect(polish).toContain('.cds-lock-register__summary > div');
    expect(polish).toContain('@media (max-width: 760px)');
    expect(polish).toContain('grid-template-columns: repeat(2,minmax(0,1fr))');
    for (const field of [
      'aria-label="Catalogue result summary"',
      'aria-label="E-lock inventory"',
      'aria-label="Search e-lock catalogue"',
      'aria-label="Filter e-lock health"',
      '<th>Device identity</th>',
      '<th>Operational state</th>',
      '<th>Assignment</th>',
      'LockBatteryReadout row={row}',
      'LockSignalReadout value={lockSignal(row)}',
      "row['last_heartbeat_event_at']",
      "row['last_persisted_event_at']",
      "row['container_number']",
      "row['truck'] ?? row['vehicle_reg']",
      'onClick={() => openLock(row)}',
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
