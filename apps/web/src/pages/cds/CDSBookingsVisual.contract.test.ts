import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const cosmic = read('./CDSCosmicVisual.css');
const bookingCss = read('./CDSBookingsVisual.css');
const overviewCss = read('./CDSOverviewVisual.css');
const bookings = read('./CDSBookings.tsx');
const manifest = read('./BookingManifest.tsx');
const group = read('./BookingGroup.tsx');
const dashboard = read('./CDSDashboard.tsx');

describe('CDS cosmic surface and booking desk visual contract', () => {
  it('loads the cosmic crystalline layer after the CDS design and overview systems', () => {
    const design = dashboard.indexOf("import './CDSDesignSystem.css'");
    const overview = dashboard.indexOf("import './CDSOverviewVisual.css'");
    const cosmicImport = dashboard.indexOf("import './CDSCosmicVisual.css'");
    expect(design).toBeGreaterThanOrEqual(0);
    expect(overview).toBeGreaterThan(design);
    expect(cosmicImport).toBeGreaterThan(overview);
  });

  it('uses animated spatial atmosphere without communicating fabricated operational telemetry', () => {
    expect(cosmic).toContain('.cds-shell::before');
    expect(cosmic).toContain('.cds-shell::after');
    expect(cosmic).toContain('@keyframes cds-cosmic-star-drift');
    expect(cosmic).toContain('@keyframes cds-crystal-veil');
    expect(cosmic).toContain('prefers-reduced-motion: reduce');
    expect(cosmic).toContain('pointer-events: none');
  });

  it('provides a first-class booking command desk with metrics derived from returned bookings', () => {
    expect(bookings).toContain('const totalContainers = rows.reduce');
    expect(bookings).toContain("useBookings({ status: 'pending' })");
    expect(bookings).toContain("useBookings({ status: 'active' })");
    expect(bookings).toContain("useBookings({ status: 'completed' })");
    expect(bookings).toContain('data?.total ?? all.length');
    expect(bookings).toContain('CONTAINERS IN CURRENT RESULTS');
    expect(bookings).toContain('aria-label="Booking status summary"');
    expect(bookings).toContain('cds-booking-command');
    expect(bookings).toContain('cds-booking-metrics');
  });

  it('keeps manifest and booking-card modes distinct and accessible', () => {
    expect(bookings).toContain('aria-pressed={view === \'manifest\'}');
    expect(bookings).toContain('aria-pressed={view === \'cards\'}');
    expect(bookings).toContain('cds-booking-manifest-frame');
    expect(manifest).toContain('cds-booking-manifest-toolbar');
    expect(manifest).toContain('cds-booking-pipeline');
    expect(group).toContain('cds-booking-group');
    expect(group).toContain('cds-booking-group__toggle');
  });

  it('keeps record editing as a separate action rather than nesting buttons', () => {
    expect(bookings).toContain('aria-expanded={open}');
    expect(bookings).toContain('cds-booking-record__edit');
    expect(bookings).not.toContain('onClick={(e) => { e.stopPropagation(); onEdit(booking); }}');
  });

  it('uses compact, information-first card proportions across the CDS command surfaces', () => {
    expect(bookingCss).toMatch(/\.cds-booking-command\s*\{[^}]*min-height:\s*132px\s*!important/s);
    expect(bookingCss).toMatch(/\.cds-booking-metric\s*\{[^}]*min-height:\s*76px\s*!important/s);
    expect(bookingCss).toMatch(/\.cds-booking-group__toggle\s*\{[^}]*min-height:\s*54px\s*!important/s);
    expect(overviewCss).toMatch(/\.cds-shell\s+\.cds-overview-metric\s*\{[^}]*min-height:\s*112px\s*!important/s);
    expect(overviewCss).toMatch(/\.cds-overview-secondary__item\s*\{[^}]*min-height:\s*76px\s*!important/s);
    expect(cosmic).toContain('animation: none !important;');
  });

  it('provides a responsive, keyboard-readable, reduced-motion-safe booking intake dialog', () => {
    expect(bookings).toContain('cds-booking-form-dialog');
    expect(bookings).toContain('cds-booking-form-fields');
    expect(bookings).toContain('cds-booking-containers-section');
    expect(bookingCss).toContain('@media (max-width: 767px)');
    expect(bookingCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(bookingCss).toContain('color: #f2f6ff !important;');
  });
});
