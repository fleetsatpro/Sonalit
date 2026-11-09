import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const pages = read('./pages.tsx');
const hooks = read('./hooks.ts');
const constants = read('./constants.ts');
const polish = read('./CDSOperationalPolish.css');
const backend = read('../../../../../backend/src/routes/cds.js');

describe('CDS fleet-scale register contract', () => {
  it('uses an API-backed, paginated lock catalogue rather than a capped client-side grid', () => {
    expect(pages).toContain('E-Lock Catalogue');
    expect(pages).toContain('cds-lock-register__table');
    expect(pages).toContain('Export selected');
    expect(pages).toContain('setPage(value => Math.min(totalPages, value + 1))');
    expect(pages).toContain('if (data && page > totalPages) setPage(totalPages);');
    expect(pages).toContain('aria-label="Select all devices on this page"');
    expect(hooks).toContain("offset: (page - 1) * limit");
    expect(hooks).toContain("health: filters.health");
    expect(hooks).toContain("search: filters.query");
    expect(hooks).not.toContain("params: { limit: 200, ...filters }");
    expect(constants).toContain("label: 'E-Lock Catalogue'");
  });

  it('preserves the existing evidence-rich lock dossier while keeping the catalogue compact', () => {
    expect(pages).toContain('<LockDossier lock={row} />');
    expect(pages).toContain('LockEventHistory');
    expect(pages).toContain('LockBatteryTrend');
    expect(pages).not.toContain('className="cds-lock-grid"');
    expect(pages).toContain('Battery history trace');
  });

  it('serves tenant-wide booking health independently from the current result page', () => {
    expect(hooks).toContain("cdsApi.get('/bookings/summary')");
    expect(pages).toContain('useBookingHealthSummary()');
    expect(pages).toContain('summary?.total');
    expect(pages).toContain("health: 'exceptions'");
    expect(pages).toContain('MATCHING BOOKINGS');
    expect(backend).toContain("router.get('/bookings/summary'");
    expect(backend).toContain('WHERE t.org_id = $1 AND t.deleted_at IS NULL');
    expect(backend).toContain("req.query.health === 'exceptions'");
  });

  it('uses the recorded port-arrival timestamp and a searchable, paginated release queue', () => {
    expect(pages).toContain("row['arrived_at']");
    expect(pages).toContain("row['lock_serial']");
    expect(pages).toContain("row['vehicleReg'] ?? row['vehicle_reg']");
    expect(pages).toContain("row['driverName'] ?? row['driver_name']");
    expect(pages).toContain("status: 'at_port'");
    expect(pages).toContain('Port Clearance');
    expect(hooks).toContain("cdsApi.get('/trips', { params })");
    expect(hooks).toContain("offset: (page - 1) * limit");
    expect(backend).toContain("'co.number', 'el.serial', 've.registration', 'tr.company_name'");
  });

  it('keeps catalogue and booking health usable on small screens with reduced-motion support', () => {
    expect(polish).toContain('@media (max-width: 760px)');
    expect(polish).toContain('@media (max-width: 560px)');
    expect(polish).toContain('@media (prefers-reduced-motion: reduce)');
    expect(polish).toContain('.cds-lock-register__table tbody tr');
    expect(polish).toContain('.cds-booking-health__pagination');
  });
});
