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
