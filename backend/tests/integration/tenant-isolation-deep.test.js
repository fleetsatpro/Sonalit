/**
 * Deep tenant-isolation regression suite.
 *
 * Uses two adversarial tenant IDs and exercises both explicit RLS transactions
 * and the legacy config/database.query() escape hatch.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { withOrg } = require('../../src/utils/orgScopedDb');
const { runWithOrgContext } = require('../../src/utils/tenantContext');
const { query } = require('../../src/config/database');

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000011';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000011';
const VEH_A = 'aaaaaaaa-0000-0000-0011-000000000001';
const VEH_B = 'bbbbbbbb-0000-0000-0011-000000000001';
const CONVOY_A = 'aaaaaaaa-0000-0000-0022-000000000001';
const CONVOY_B = 'bbbbbbbb-0000-0000-0022-000000000001';
const USER_A = 'aaaaaaaa-0000-0000-0033-000000000001';
const USER_B = 'bbbbbbbb-0000-0000-0033-000000000001';
const DEV_A = 'aaaaaaaa-0000-0000-0044-000000000001';
const DEV_B = 'bbbbbbbb-0000-0000-0044-000000000001';

const BOOTSTRAP_TABLES = new Set([
  'users', 'guardian_devices', 'portal_tokens', 'cargo_clients', 'client_magic_links',
  'telemetry_ingest_keys', 'tracking_qr_codes', 'tracking_sessions', 'field_devices',
  'field_sessions', 'field_agent_pins', 'cfo_login_attempts', 'guardian_command_nonces',
]);

let pool;
const skip = () => !process.env.DATABASE_URL;

beforeAll(async () => {
  if (skip()) return;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  await pool.query(`
    INSERT INTO users (id, org_id, email, name, password_hash, role, status)
    VALUES ($1,$3,$5,$7,$9,$11,$13), ($2,$4,$6,$8,$10,$12,$14)
    ON CONFLICT (id) DO UPDATE
      SET org_id=EXCLUDED.org_id, email=EXCLUDED.email, role=EXCLUDED.role, status=EXCLUDED.status
  `, [USER_A, USER_B, ORG_A, ORG_B, 'deep-a@example.test', 'deep-b@example.test', 'Deep A', 'Deep B', 'x', 'x', 'admin', 'admin', 'active', 'active']);

  await pool.query(`
    INSERT INTO vehicles (id, type, registration, region, status, org_id)
    VALUES ($1,$3,$5,$7,$9,$11), ($2,$4,$6,$8,$10,$12)
    ON CONFLICT (id) DO UPDATE
      SET org_id=EXCLUDED.org_id, registration=EXCLUDED.registration, status='idle'
  `, [VEH_A, VEH_B, 'SUV', 'SUV', 'DEEP-ORG-A', 'DEEP-ORG-B', 'TEST', 'TEST', 'idle', 'idle', ORG_A, ORG_B]);

  await pool.query(`
    INSERT INTO convoys (id, name, region, status, priority, created_by, org_id)
    VALUES ($1,$3,$5,$7,$9,$11,$13), ($2,$4,$6,$8,$10,$12,$14)
    ON CONFLICT (id) DO UPDATE
      SET org_id=EXCLUDED.org_id, created_by=EXCLUDED.created_by, deleted_at=NULL
  `, [CONVOY_A, CONVOY_B, 'Deep A', 'Deep B', 'TEST', 'TEST', 'planned', 'planned', 'medium', 'medium', USER_A, USER_B, ORG_A, ORG_B]);

  await pool.query(`
    INSERT INTO guardian_devices (id, token, name, status, org_id)
    VALUES ($1, gen_random_uuid(), $3, $5, $7), ($2, gen_random_uuid(), $4, $6, $8)
    ON CONFLICT (id) DO UPDATE SET org_id=EXCLUDED.org_id, status='enrolled'
  `, [DEV_A, DEV_B, 'Deep Guardian A', 'Deep Guardian B', 'enrolled', 'enrolled', ORG_A, ORG_B]);
});

afterAll(async () => {
  if (!pool) return;
  await pool.query('DELETE FROM convoy_cfos WHERE convoy_id IN ($1,$2)', [CONVOY_A, CONVOY_B]).catch(() => {});
  await pool.query('DELETE FROM convoy_assignments WHERE convoy_id IN ($1,$2)', [CONVOY_A, CONVOY_B]).catch(() => {});
  await pool.query('DELETE FROM guardian_devices WHERE id IN ($1,$2)', [DEV_A, DEV_B]).catch(() => {});
  await pool.query('DELETE FROM convoys WHERE id IN ($1,$2)', [CONVOY_A, CONVOY_B]).catch(() => {});
  await pool.query('DELETE FROM vehicles WHERE id IN ($1,$2)', [VEH_A, VEH_B]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN ($1,$2)', [USER_A, USER_B]).catch(() => {});
  await pool.end();
});

test('all current tenant-bearing public tables are RLS protected', async () => {
  if (skip()) return;
  const result = await pool.query(`
    SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity,
           EXISTS (
             SELECT 1 FROM pg_policies p
             WHERE p.schemaname='public'
               AND p.tablename=c.relname
               AND p.policyname='tenant_isolation_hardening'
               AND p.permissive='RESTRICTIVE'
           ) AS hardening_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public'
       AND c.relkind IN ('r','p')
       AND c.relname <> 'runtime_diagnostics'
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
         WHERE a.attrelid=c.oid AND a.attname='org_id' AND NOT a.attisdropped
       )
     ORDER BY c.relname
  `);

  expect(result.rows.length).toBeGreaterThan(0);
  for (const row of result.rows) {
    expect(row.relrowsecurity).toBe(true);
    expect(row.hardening_policy).toBe(true);
    if (!BOOTSTRAP_TABLES.has(row.table_name)) expect(row.relforcerowsecurity).toBe(true);
  }
});

test('raw legacy query inherits tenant context', async () => {
  if (skip()) return;
  const result = await runWithOrgContext(ORG_A, () => query(
    'SELECT id, registration, org_id FROM vehicles WHERE id IN ($1,$2) ORDER BY registration',
    [VEH_A, VEH_B]
  ));
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].id).toBe(VEH_A);
  expect(result.rows[0].org_id).toBe(ORG_A);
});

test('withOrg propagates tenant context to nested legacy query calls', async () => {
  if (skip()) return;
  const result = await withOrg(ORG_B, () => query(
    'SELECT id, registration, org_id FROM vehicles WHERE id IN ($1,$2) ORDER BY registration',
    [VEH_A, VEH_B]
  ));
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].id).toBe(VEH_B);
  expect(result.rows[0].org_id).toBe(ORG_B);
});

test('tenant A cannot modify tenant B through a raw legacy query', async () => {
  if (skip()) return;
  const result = await runWithOrgContext(ORG_A, () =>
    query("UPDATE vehicles SET status='offline' WHERE id=$1 RETURNING id", [VEH_B])
  );
  expect(result.rowCount).toBe(0);
  const verification = await pool.query('SELECT status, org_id FROM vehicles WHERE id=$1', [VEH_B]);
  expect(verification.rows[0].org_id).toBe(ORG_B);
  expect(verification.rows[0].status).toBe('idle');
});

test('tenant A cannot attach tenant B vehicle to tenant A convoy', async () => {
  if (skip()) return;
  await expect(withOrg(ORG_A, client => client.query(
    'INSERT INTO convoy_assignments (convoy_id, vehicle_id, role) VALUES ($1,$2,$3)',
    [CONVOY_A, VEH_B, 'escort']
  ))).rejects.toThrow(/tenant_scope_parent_mismatch|tenant_scope/i);
});

test('tenant A cannot attach tenant B CFO or device to tenant A convoy', async () => {
  if (skip()) return;
  await expect(withOrg(ORG_A, client => client.query(
    'INSERT INTO convoy_cfos (convoy_id, cfo_user_id, guardian_device_id) VALUES ($1,$2,$3)',
    [CONVOY_A, USER_B, DEV_B]
  ))).rejects.toThrow(/tenant_scope_parent_mismatch|tenant_scope/i);
});


test('sonalit_app sees zero tenant rows when tenant context is unset', async () => {
  if (skip()) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE sonalit_app');
    const result = await client.query(
      'SELECT id FROM vehicles WHERE id IN ($1,$2)',
      [VEH_A, VEH_B],
    );
    expect(result.rows).toHaveLength(0);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});
