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
    expect(route).toContain('SELECT id, lock_id, container_id FROM cds_trips WHERE id=$1 AND deleted_at IS NULL FOR UPDATE');
    expect(route).toContain('Cannot unclamp a container in state');
    expect(route).toContain('await appendCustodyEvent(req');
    expect(route).toContain('INSERT INTO cds_audit_logs');
    expect(route.indexOf('return {\n      bc: bc.rows[0]')).toBeGreaterThan(route.indexOf('INSERT INTO cds_audit_logs'));
    expect(route.indexOf('T.onContainerDelivered')).toBeGreaterThan(route.indexOf('if (operation.response)'));
  });

  test('legacy trip clamp/unclamp also use transaction and row locks', () => {
    const clamp = routeBetween(source, "router.post('/trips/:id/clamp'", "router.post('/trips/:id/unclamp'");
    const unclamp = routeBetween(source, "router.post('/trips/:id/unclamp'", '// ══════════════════════════════════════════════════════════════\n// 9. Bookings');
    expect(clamp).toContain('req.dbTx(async () =>');
    expect(clamp).toContain('FOR UPDATE');
    expect(unclamp).toContain('req.dbTx(async () =>');
    expect(unclamp).toContain('FOR UPDATE');
    expect(source).not.toContain("'SecuriSat'");
  });

  test('schema preserves missing compliance data rather than manufacturing facts', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('license_number DROP NOT NULL');
    expect(migration).toContain("DEFAULT 'unverified'");
    expect(migration).toContain("WHERE upper(btrim(COALESCE(license_number, ''))) = 'PENDING'");
    expect(migration).toContain("UPDATE public.cds_drivers SET phone = NULL WHERE phone = '-'");
    expect(migration).toContain('license_verification_source');
  });

  test('custody chain write failures abort the enclosing transaction', () => {
    const helper = source.slice(source.indexOf('async function appendCustodyEvent'), source.indexOf('function paginate'));
    expect(helper).toContain('throw err;');
  });
});
