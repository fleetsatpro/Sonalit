'use strict';

const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../src/routes/cds.js');
const migrationPath = path.join(__dirname, '../migrations/20261019_001_cds_truthful_driver_compliance.sql');

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
    expect(route).toContain("SET status='in_transit', current_location=$2");
    expect(route).toContain('FOR UPDATE');
    expect(route).toContain('await appendCustodyEvent(req');
    expect(route.indexOf('await appendCustodyEvent(req')).toBeLessThan(route.indexOf('return { bc: bc.rows[0]'));
    expect(route).not.toContain("'PENDING'");
    expect(route).not.toContain("'SecuriSat'");
  });

  test('booking unclamp commits lock, manifest, custody, tamper alert and audit together', () => {
    const route = routeBetween(source,
      "router.post('/bookings/:id/containers/:cid/unclamp'",
      '// ══════════════════════════════════════════════════════════════\n// 10. Alerts');
    expect(route).toContain('req.dbTx(async () =>');
    expect(route).toContain('SELECT id FROM cds_bookings WHERE id=$1 AND deleted_at IS NULL FOR UPDATE');
    expect(route).toContain('FOR UPDATE OF bc');
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
    const unclamp = routeBetween(source, "router.post('/trips/:id/unclamp'", '// ══════════════════════════════════════════════════════════════\\n// 9. Bookings');
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
