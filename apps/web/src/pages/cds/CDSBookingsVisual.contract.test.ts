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
const components = read('./components.tsx');
const register = read('./CDSContainerRegister.tsx');
const modulePages = read('./pages.tsx');
const hooks = read('./hooks.ts');
const dataPage = read('./CDSDataPage.tsx');
const polish = read('./CDSOperationalPolish.css');

describe('CDS cosmic surface and booking desk visual contract', () => {
  it('uses the persisted e-lock telemetry contract and exposes a charging battery indicator', () => {
    const lockStart = modulePages.indexOf('const LOCK_HEARTBEAT_STALE_MS');
    const lockEnd = modulePages.indexOf('export function PortView()', lockStart);
    const lockConsole = modulePages.slice(lockStart, lockEnd);
    expect(lockConsole).toContain('battery_level');
    expect(lockConsole).toContain('signal_strength');
    expect(lockConsole).toContain('tamper_detected');
    expect(lockConsole).toContain('last_heartbeat');
    expect(lockConsole).toContain('solar_charging');
    expect(lockConsole).toContain('firmware_version');
    expect(lockConsole).toContain('BatteryCharging');
    expect(lockConsole).toContain('LockEventHistory');
    expect(lockConsole).toContain('aria-label="Filter e-lock inventory"');
    expect(lockConsole).toContain('aria-pressed={filter === item.id}');
    expect(lockConsole).toContain('Remote lock / unlock actuation is not exposed');
    expect(lockConsole).not.toContain('Ping device');
    expect(hooks).toContain("limit: 200");
    expect(hooks).toContain('/locks/\u0024{encodeURIComponent(lockId)}/events');
    expect(polish).toContain('@keyframes cds-lock-battery-charge');
    expect(polish).toContain('prefers-reduced-motion: reduce');
  });

  it('loads the cosmic crystalline layer after the CDS design and overview systems', () => {
    const design = dashboard.indexOf("import './CDSDesignSystem.css'");
    const overview = dashboard.indexOf("import './CDSOverviewVisual.css'");
    const cosmicImport = dashboard.indexOf("import './CDSCosmicVisual.css'");
    const polishImport = dashboard.indexOf("import './CDSOperationalPolish.css'");
    expect(design).toBeGreaterThanOrEqual(0);
    expect(overview).toBeGreaterThan(design);
    expect(cosmicImport).toBeGreaterThan(overview);
    expect(polishImport).toBeGreaterThan(cosmicImport);
  });

  it('uses animated spatial atmosphere without communicating fabricated operational telemetry', () => {
    expect(cosmic).toContain('.cds-shell::before');
    expect(cosmic).toContain('.cds-shell::after');
    expect(cosmic).toContain('@keyframes cds-cosmic-starfield-float');
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

  it('exposes the selected state of reusable filter controls to assistive technology', () => {
    expect(components).toContain('aria-pressed={Boolean(active)}');
    expect(polish).toContain('.cds-booking-status-filters button[aria-pressed="true"]');
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

  it('gives every legacy CDS submodule a clear, non-duplicated workspace heading', () => {
    expect(dashboard).toContain('data-view={activeView}');
    expect(dashboard).toContain('<CDSModuleHeading activeView={activeView} />');
    for (const id of ['live', 'locks', 'port', 'pulse', 'analytics', 'reports', 'settings']) {
      expect(dashboard).toContain(`${id}:`);
    }
    expect(polish).toContain('.cds-module-heading');
    expect(polish).toContain('@media (max-width: 767px)');
  });

  it('extends the shared high-contrast operational finish across CDS modules', () => {
    expect(polish).toContain('[data-view="containers"]');
    expect(polish).toContain('[data-view="transporters"]');
    expect(polish).toContain('[data-view="inbox"]');
    expect(polish).toContain('[data-view="locks"]');
    expect(polish).toContain('[data-view="port"]');
    expect(polish).toContain('[data-view="pulse"]');
    expect(polish).toContain('[data-view="analytics"]');
    expect(polish).toContain('[data-view="reports"]');
    expect(polish).toContain('[data-view="settings"]');
    expect(polish).toContain('prefers-reduced-motion: reduce');
    expect(polish).toContain('position: sticky');
  });

  it('provides a responsive, keyboard-readable, reduced-motion-safe booking intake dialog', () => {
    expect(bookings).toContain('cds-booking-form-dialog');
    expect(bookings).toContain('cds-booking-form-fields');
    expect(bookings).toContain('cds-booking-containers-section');
    expect(bookingCss).toContain('@media (max-width: 767px)');
    expect(bookingCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(bookingCss).toContain('color: #f2f6ff !important;');
  });

  it('keeps perpetual cosmic motion compositor-friendly and restrained on mobile', () => {
    const starfield = cosmic.match(/@keyframes cds-cosmic-starfield-float\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const nebula = cosmic.match(/@keyframes cds-crystal-veil\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(starfield).toContain('transform:');
    expect(starfield).not.toMatch(/background-position|box-shadow|filter/);
    expect(nebula).toContain('transform:');
    expect(nebula).toContain('opacity:');
    expect(nebula).not.toMatch(/background-position|box-shadow|filter/);
    expect(cosmic).toContain('animation-duration: 168s;');
    expect(cosmic).toContain('prefers-reduced-motion: reduce');
    expect(polish).toContain('@media (hover: hover) and (pointer: fine)');
    expect(polish).toContain('scale(.985)');
    expect(polish).toContain('prefers-reduced-motion: reduce');
  });

  it('uses purpose-built vector container artwork and keeps emoji/glyph substitutes out of operational screens', () => {
    expect(components).toContain('data-icon="intermodal-container"');
    expect(bookings).toContain("import { StatusBadge, FilterChip, ContainerArtwork } from './components.js'");
    expect(manifest).toContain("import { ContainerArtwork } from './components.js'");
    expect(bookings).not.toContain('<Package');
    expect(manifest).not.toContain('Package');
    expect(dashboard).not.toContain('aria-hidden="true">↗</span>');
    const operationalScreens = [bookings, manifest, dashboard, register, modulePages, dataPage];
    expect(operationalScreens.every(source => !/\p{Extended_Pictographic}/u.test(source))).toBe(true);
    expect(components).toContain('<ArrowUp size={12}');
    expect(components).toContain('<ArrowDown size={12}');
    expect(dashboard).toContain('<ArrowUpRight size={13}');
    expect(modulePages).toContain('<ArrowUpRight size={12}');
    expect(manifest).toContain('<ChevronDown size={11}');
  });

});
