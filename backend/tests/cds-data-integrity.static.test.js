'use strict';

const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../src/routes/cds.js');
const migrationPath = path.join(__dirname, '../migrations/20261019_001_cds_truthful_driver_compliance.sql');
const metricsMigrationPath = path.join(__dirname, '../migrations/20261019_003_cds_performance_metrics_truthful.sql');

function routeBetween(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b <= a) throw new Error('Route boundary not found: ' + start);
  return source.slice(a, b);
}

describe('CDS data-integrity regression guards', () => {
  const source = fs.readFileSync(routePath, 'utf8');

  test('booking clamp serializes the transition and requires custody evidence', () => {
    const route = routeBetween(source,
      "router.post('/bookings/:id/containers/:cid/clamp'",
      "router.post('/bookings/:id/containers/:cid/unclamp'");
    expect(route).toContain('req.dbTx(async () =>');
    expect(route).toContain('SELECT id FROM cds_bookings WHERE id=$1 AND deleted_at IS NULL FOR UPDATE');
    expect(route).toContain('FOR UPDATE OF bc');
    expect(route).toContain('Container number is required before clamping');
    expect(route).toContain('Electronic lock is not available or is already assigned');
    expect(route).toContain('pg_advisory_xact_lock(hashtext($1))');
    expect(route).toContain('upper(serial) = upper($1)');
    expect(route).toContain("status !== 'available'");
    expect(route).toContain('Container is already linked to an active trip');
    expect(route).toContain('ON CONFLICT DO NOTHING');
    expect(route).toContain('Electronic-lock serial already exists');
    expect(route).toContain("SET status='in_transit', current_location=$2");
    expect(route).toContain('FOR UPDATE');
    expect(route).toContain('await appendCustodyEvent(req');
    expect(route).toContain('sealIntact: null');
    expect(route).not.toContain('sealIntact: true');
    expect(route.indexOf('await appendCustodyEvent(req')).toBeLessThan(route.indexOf('return { bc: bc.rows[0]'));
    expect(route).not.toContain("'PENDING'");
    expect(route).not.toContain("'SecuriSat'");
  });

  test('CDS list APIs expose fields required by the legacy container-delivery client', () => {
    const drivers = routeBetween(source, "router.get('/drivers'", "router.get('/drivers/:id'");
    expect(drivers).toContain('LEFT JOIN cds_transporters tr');
    expect(drivers).toContain('LEFT JOIN cds_vehicles ve');
    expect(drivers).toContain('tr.company_name AS transporter_name');
    expect(drivers).toContain('ve.registration AS current_vehicle_registration');

    const legacyDir = path.join(__dirname, '../../apps/container-delivery-system/src/pages');
    const driverPage = fs.readFileSync(path.join(legacyDir, 'Drivers.tsx'), 'utf8');
    const customerPage = fs.readFileSync(path.join(legacyDir, 'Customers.tsx'), 'utf8');
    const transporterPage = fs.readFileSync(path.join(legacyDir, 'Transporters.tsx'), 'utf8');
    expect(driverPage).toContain("d['transporter_name']");
    expect(driverPage).toContain("d['current_vehicle_registration']");
    expect(driverPage).toContain("d['total_trips']");
    expect(customerPage).toContain("c['company_name']");
    expect(customerPage).toContain("c['sla_compliance']");
    expect(transporterPage).toContain("t['on_time_rate']");
    expect(transporterPage).toContain("t['avg_clamp_time']");
    expect(transporterPage).toContain("t['total_trips']");
  });

  test('unverified default-shaped performance metrics are preserved for reconciliation, not shown as live data', () => {
    const migration = fs.readFileSync(metricsMigrationPath, 'utf8');
    expect(migration).toContain('cds_metric_reconciliation_archive');
    expect(migration).toContain('ALTER COLUMN rating DROP DEFAULT');
    expect(migration).toContain('ALTER COLUMN on_time_rate DROP DEFAULT');
    expect(migration).toContain('ALTER COLUMN sla_compliance DROP DEFAULT');
    expect(migration).toContain('UPDATE public.cds_drivers SET rating = NULL');
    expect(migration).toContain('UPDATE public.cds_transporters SET on_time_rate = NULL');
    expect(migration).toContain('ALTER TABLE public.cds_metric_reconciliation_archive ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE public.cds_metric_reconciliation_archive FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY tenant_isolation_hardening');
    expect(migration).toContain('CREATE POLICY tenant_base_fallback');
    const report = fs.readFileSync(path.join(__dirname, '../src/routes/reports.js'), 'utf8');
    expect(report).toContain('row.total_completed > 0 ? Math.round((row.on_time / row.total_completed) * 100) : null');
  });

  test('booking unclamp commits lock, manifest, custody, tamper alert and audit together', () => {
    const route = routeBetween(source,
      "router.post('/bookings/:id/containers/:cid/unclamp'",
      '// ══════════════════════════════════════════════════════════════\n// 10. Alerts');
    expect(route).toContain('req.dbTx(async () =>');
    expect(route).toContain('SELECT id FROM cds_bookings WHERE id=$1 AND deleted_at IS NULL FOR UPDATE');
    expect(route).toContain('FOR UPDATE OF bc');
    expect(route).toContain('SELECT bc.*, b.booking_number, b.delivery_location, t.id AS trip_id, t.container_id AS trip_container_id');
    expect(route).toContain('SELECT id, booking_id, status, lock_id, container_id, vehicle_id FROM cds_trips WHERE id=$1 AND deleted_at IS NULL FOR UPDATE');
    expect(route).toContain('SELECT id, status, container_id, vehicle_id FROM cds_electronic_locks WHERE id=$1 AND deleted_at IS NULL FOR UPDATE');
    expect(route).toContain('Trip-to-booking-container link is missing or ambiguous');
    expect(route).toContain('Associated e-lock is not active');
    expect(route).toContain('E-lock/container/vehicle association is inconsistent');
    expect(route).toContain("SET status='delivered', current_location=$2");
    expect(route).toContain('sealVerdict = observed.toUpperCase() === expectedSeal.toUpperCase()');
    expect(route).toContain('observed_seal must be a string no longer than 50 characters');
    expect(route).toContain('Unclamp coordinates are outside valid latitude/longitude ranges');
    expect(route).toContain('lockId,');
    expect(route).toContain('Cannot unclamp a container in state');
    expect(route).toContain('await appendCustodyEvent(req');
    expect(route).toContain('INSERT INTO cds_audit_logs');
    expect(route.indexOf('return {\n      bc: bc.rows[0]')).toBeGreaterThan(route.indexOf('INSERT INTO cds_audit_logs'));
    expect(route.indexOf('T.onContainerDelivered')).toBeGreaterThan(route.indexOf('if (operation.response)'));
  });

  test('legacy trip clamp/unclamp fail closed and identify the canonical booking-container route', () => {
    const clamp = routeBetween(source, "router.post('/trips/:id/clamp'", "router.post('/trips/:id/unclamp'");
    const unclamp = routeBetween(source, "router.post('/trips/:id/unclamp'", "// 9. Bookings");
    for (const route of [clamp, unclamp]) {
      expect(route).toContain('requireIdempotencyKey');
      expect(route).toContain('booking_container_link_required');
      expect(route).toContain('canonical_route_required');
      expect(route).toContain('SELECT id, booking_id FROM cds_booking_containers');
      expect(route).not.toContain('UPDATE cds_trips');
      expect(route).not.toContain('UPDATE cds_electronic_locks');
      expect(route).not.toContain('INSERT INTO cds_audit_logs');
    }

    const tripProjection = source.slice(source.indexOf('const TRIP_JOINS'), source.indexOf("router.get('/trips'"));
    expect(tripProjection).toContain('booking_container_id');
    expect(tripProjection).toContain('booking_container_link_count');
  });

  test('port UI uses the canonical endpoint and blocks missing or ambiguous links', () => {
    const pagePath = path.join(__dirname, '../../apps/web/src/pages/cds/pages.tsx');
    const hookPath = path.join(__dirname, '../../apps/web/src/pages/cds/hooks.ts');
    const page = fs.readFileSync(pagePath, 'utf8');
    const hook = fs.readFileSync(hookPath, 'utf8');
    expect(page).toContain("r['booking_container_link_count']");
    expect(page).toContain('Unclamp blocked');
    expect(hook).toContain('/bookings/\${booking_id}/containers/\${booking_container_id}/unclamp');
    expect(hook).toContain('Number(booking_container_link_count) !== 1');
  });

  test('schema preserves missing compliance data rather than manufacturing facts', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('license_number DROP NOT NULL');
    expect(migration).toContain("DEFAULT 'unverified'");
    expect(migration).toContain("WHERE upper(btrim(COALESCE(license_number, ''))) = 'PENDING'");
    expect(migration).toContain("UPDATE public.cds_drivers SET phone = NULL WHERE phone = '-'");
    expect(migration).toContain('license_verification_source');
    expect(migration).toContain('ALTER COLUMN provider DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN provider DROP DEFAULT');
    expect(migration).toContain('idx_cds_booking_containers_trip');
  });

  test('custody chain write failures abort the enclosing transaction', () => {
    const helper = source.slice(source.indexOf('async function appendCustodyEvent'), source.indexOf('function paginate'));
    expect(helper).toContain('throw err;');
  });
});
