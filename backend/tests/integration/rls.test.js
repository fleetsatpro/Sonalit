/**
 * T1.1 — RLS integration test
 * Proves org-level data isolation: org A cannot read or modify org B's rows.
 *
 * Requires a live DATABASE_URL. Skips gracefully if not configured.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { withOrg } = require('../../src/utils/orgScopedDb');

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000001';

let pool;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

  // Seed two vehicles, one per org (idempotent)
  await pool.query(`
    INSERT INTO vehicles (id, type, registration, region, status, org_id)
    VALUES
      ('aaaaaaaa-0000-0000-0001-000000000001', 'SUV', 'TEST-ORG-A-001', 'Test', 'idle', $1),
      ('bbbbbbbb-0000-0000-0001-000000000001', 'SUV', 'TEST-ORG-B-001', 'Test', 'idle', $2)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id
  `, [ORG_A, ORG_B]);
});

afterAll(async () => {
  if (!pool) return;
  // Clean up test rows
  await pool.query(`DELETE FROM vehicles WHERE registration IN ('TEST-ORG-A-001','TEST-ORG-B-001')`);
  await pool.end();
});

const skip = () => !process.env.DATABASE_URL;

test('org A sees only its own vehicle', async () => {
  if (skip()) return;
  const result = await withOrg(ORG_A, client =>
    client.query(`SELECT id, registration, org_id FROM vehicles WHERE registration IN ('TEST-ORG-A-001','TEST-ORG-B-001')`)
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].org_id).toBe(ORG_A);
});

test('org A cannot UPDATE org B vehicle', async () => {
  if (skip()) return;
  const result = await withOrg(ORG_A, client =>
    client.query(`UPDATE vehicles SET status='offline' WHERE id='bbbbbbbb-0000-0000-0001-000000000001'`)
  );
  expect(result.rowCount).toBe(0);
});

test('org B sees only its own vehicle', async () => {
  if (skip()) return;
  const result = await withOrg(ORG_B, client =>
    client.query(`SELECT id, registration FROM vehicles WHERE registration IN ('TEST-ORG-A-001','TEST-ORG-B-001')`)
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].registration).toBe('TEST-ORG-B-001');
});

// The drivers route (backend/src/routes/drivers.js) was moved onto req.db/withOrg;
// that only isolates data if the drivers table actually carries RLS + the
// org_isolation policy. Assert it via the catalog (schema-independent — no seed
// row needed, so this doesn't depend on the drivers DDL which lives outside the
// tracked migrations).
test('every tenant-bearing base table is FORCE-RLS protected', async () => {
  const { rows } = await pool.query(`
    SELECT c.relname AS table_name,
           c.relforcerowsecurity,
           EXISTS (
             SELECT 1 FROM pg_policies p
             WHERE p.schemaname='public'
               AND p.tablename=c.relname
               AND p.policyname='tenant_isolation_hardening'
               AND p.permissive='RESTRICTIVE'
           ) AS has_restrictive_tenant_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public'
       AND c.relkind='r'
       AND c.relname <> 'runtime_diagnostics'
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
         WHERE a.attrelid=c.oid AND a.attname='org_id' AND NOT a.attisdropped
       )
     ORDER BY c.relname
  `);
  const failures = rows.filter(r => !r.relforcerowsecurity || !r.has_restrictive_tenant_policy);
  expect(failures).toEqual([]);
});

test('drivers table has RLS enabled with an org_isolation policy', async () => {
  if (skip()) return;
  const rls = await pool.query(
    `SELECT relrowsecurity FROM pg_class WHERE relname = 'drivers'`
  );
  expect(rls.rows).toHaveLength(1);
  expect(rls.rows[0].relrowsecurity).toBe(true);

  const policy = await pool.query(
    `SELECT 1 FROM pg_policies WHERE tablename = 'drivers' AND policyname = 'org_isolation'`
  );
  expect(policy.rows).toHaveLength(1);
});

// Migration 063 retrofits org_id + FORCEd RLS onto the finance/maintenance
// tables so finance.js / maintenance.js (now on req.db) are actually isolated.
// Assert each carries RLS, FORCE, and the org_isolation policy via the catalog.
test.each(['trips', 'invoices', 'expenses', 'maintenance_records'])(
  '%s has FORCEd RLS with an org_isolation policy',
  async (tbl) => {
    if (skip()) return;
    const rls = await pool.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
      [tbl]
    );
    expect(rls.rows).toHaveLength(1);
    expect(rls.rows[0].relrowsecurity).toBe(true);
    expect(rls.rows[0].relforcerowsecurity).toBe(true);

    const policy = await pool.query(
      `SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = 'org_isolation'`,
      [tbl]
    );
    expect(policy.rows).toHaveLength(1);
  }
);
