/**
 * Tenant isolation matrix — executed against a real PostgreSQL database.
 *
 * This suite tests the database boundary directly rather than only through
 * HTTP, because RLS is the layer that has to hold when an application query
 * forgets its tenant filter. Every assertion runs as the RLS-enforced
 * `sonalit_app` role, which is what the application actually connects as.
 *
 * Fixtures follow the standard matrix: a platform admin, two independent
 * tenants each with an admin and a user, and a suspended tenant.
 *
 * Requires DATABASE_URL and skips cleanly without one.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');

const skip = () => !process.env.DATABASE_URL;

const TENANT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const TENANT_SUSPENDED = 'cccccccc-0000-4000-8000-00000000000c';

const USER_PLATFORM = 'dddddddd-0000-4000-8000-000000000001';
const USER_A_ADMIN = 'dddddddd-0000-4000-8000-00000000000a';
const USER_B_ADMIN = 'dddddddd-0000-4000-8000-00000000000b';
const USER_SUSPENDED = 'dddddddd-0000-4000-8000-00000000000c';

let pool;
let vehicleA;
let vehicleB;

/** Run a callback inside a tenant-scoped transaction, exactly as withOrg does. */
async function asTenant(tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE sonalit_app');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', tenantId]);
    return await fn(client);
  } finally {
    try { await client.query('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
    client.release();
  }
}

/** Run a callback with platform scope, exactly as withPlatform does. */
async function asPlatform(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE sonalit_app');
    await client.query('SELECT set_config($1, $2, true)', ['app.platform_scope', 'on']);
    return await fn(client);
  } finally {
    try { await client.query('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
    client.release();
  }
}

/**
 * Assert that an operation is refused by the database. Returns the error so a
 * caller can check the code — an RLS refusal is 42501.
 */
async function expectRejected(promise) {
  let error = null;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  expect(error).not.toBeNull();
  return error;
}

beforeAll(async () => {
  if (skip()) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

  // Fixtures are created as the owner (bypassing RLS) so the test can set up
  // rows in both tenants — that is the point of the isolation checks below.
  await pool.query(
    `INSERT INTO tenants (id, name, slug, status, data_classification, enabled_modules)
     VALUES ($1,'Tenant A','tenant-a-fixture','ACTIVE','TENANT',ARRAY['FLEET','CONVOY','GPS','ALERTS','REPORTING','CDS']),
            ($2,'Tenant B','tenant-b-fixture','ACTIVE','TENANT',ARRAY['FLEET','CONVOY','GPS','ALERTS','REPORTING','CDS']),
            ($3,'Suspended','tenant-susp-fixture','SUSPENDED','TENANT',ARRAY['FLEET'])
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
    [TENANT_A, TENANT_B, TENANT_SUSPENDED]
  );

  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, role, status, org_id)
     VALUES ($1,'platform@fixture.test','Platform Op','x','admin','active',$5),
            ($2,'a-admin@fixture.test','A Admin','x','admin','active',$5),
            ($3,'b-admin@fixture.test','B Admin','x','admin','active',$6),
            ($4,'susp@fixture.test','Susp User','x','operator','active',$7)
     ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, status = 'active'`,
    [USER_PLATFORM, USER_A_ADMIN, USER_B_ADMIN, USER_SUSPENDED, TENANT_A, TENANT_B, TENANT_SUSPENDED]
  );

  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status)
     VALUES ($1,$4,'admin','ACTIVE'), ($2,$5,'admin','ACTIVE'), ($3,$6,'operator','ACTIVE')
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET status = 'ACTIVE'`,
    [USER_A_ADMIN, USER_B_ADMIN, USER_SUSPENDED, TENANT_A, TENANT_B, TENANT_SUSPENDED]
  );

  await pool.query(
    `INSERT INTO platform_admins (user_id, role, status)
     VALUES ($1,'PLATFORM_ADMIN','ACTIVE')
     ON CONFLICT (user_id) DO UPDATE SET status = 'ACTIVE', revoked_at = NULL`,
    [USER_PLATFORM]
  );

  const a = await pool.query(
    `INSERT INTO vehicles (org_id, type, registration, region)
     VALUES ($1,'truck','ISO-FIXTURE-A','RegionA') RETURNING id`, [TENANT_A]);
  const b = await pool.query(
    `INSERT INTO vehicles (org_id, type, registration, region)
     VALUES ($1,'truck','ISO-FIXTURE-B','RegionB') RETURNING id`, [TENANT_B]);
  vehicleA = a.rows[0].id;
  vehicleB = b.rows[0].id;
});

afterAll(async () => {
  if (skip() || !pool) return;
  await pool.query(`DELETE FROM vehicles WHERE registration LIKE 'ISO-FIXTURE-%'`);
  await pool.query(`DELETE FROM support_sessions WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B, TENANT_SUSPENDED]]);
  await pool.query(`DELETE FROM security_events WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B, TENANT_SUSPENDED]]);
  await pool.query(`DELETE FROM platform_admins WHERE user_id = $1`, [USER_PLATFORM]);
  await pool.query(`DELETE FROM memberships WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B, TENANT_SUSPENDED]]);
  await pool.query(`DELETE FROM users WHERE email LIKE '%@fixture.test'`);
  await pool.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[TENANT_A, TENANT_B, TENANT_SUSPENDED]]);
  await pool.end();
});

describe('tenant data isolation — SELECT', () => {
  test('A sees its own rows', async () => {
    if (skip()) return;
    const rows = await asTenant(TENANT_A, (c) =>
      c.query(`SELECT registration FROM vehicles WHERE registration LIKE 'ISO-FIXTURE-%'`));
    expect(rows.rows.map((r) => r.registration)).toEqual(['ISO-FIXTURE-A']);
  });

  test('A cannot see B rows, even addressing them by primary key', async () => {
    if (skip()) return;
    // The id is known and valid — this is the IDOR case. RLS makes it return
    // nothing rather than someone else's vehicle.
    const rows = await asTenant(TENANT_A, (c) =>
      c.query('SELECT id FROM vehicles WHERE id = $1', [vehicleB]));
    expect(rows.rowCount).toBe(0);
  });

  test('B cannot see A rows', async () => {
    if (skip()) return;
    const rows = await asTenant(TENANT_B, (c) =>
      c.query('SELECT id FROM vehicles WHERE id = $1', [vehicleA]));
    expect(rows.rowCount).toBe(0);
  });

  test('an unset tenant context sees nothing (deny by default)', async () => {
    if (skip()) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE sonalit_app');
      const rows = await client.query(
        `SELECT count(*)::int AS n FROM vehicles WHERE registration LIKE 'ISO-FIXTURE-%'`);
      expect(rows.rows[0].n).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('tenant data isolation — writes', () => {
  test('A cannot INSERT a row owned by B', async () => {
    if (skip()) return;
    const err = await expectRejected(asTenant(TENANT_A, (c) =>
      c.query(`INSERT INTO vehicles (org_id, type, registration, region)
               VALUES ($1,'truck','ISO-FIXTURE-FORGED','X')`, [TENANT_B])));
    expect(err.code).toBe('42501');
  });

  test('A cannot move its own row into B (tenant ownership is immutable)', async () => {
    if (skip()) return;
    const err = await expectRejected(asTenant(TENANT_A, (c) =>
      c.query('UPDATE vehicles SET org_id = $1 WHERE id = $2', [TENANT_B, vehicleA])));
    expect(err.code).toBe('42501');
  });

  test('A cannot UPDATE a B row', async () => {
    if (skip()) return;
    const res = await asTenant(TENANT_A, (c) =>
      c.query(`UPDATE vehicles SET region = 'HIJACKED' WHERE id = $1`, [vehicleB]));
    expect(res.rowCount).toBe(0);
  });

  test('A cannot DELETE a B row', async () => {
    if (skip()) return;
    const res = await asTenant(TENANT_A, (c) =>
      c.query('DELETE FROM vehicles WHERE id = $1', [vehicleB]));
    expect(res.rowCount).toBe(0);
  });

  test("B's row survives every attempt A made against it", async () => {
    if (skip()) return;
    const rows = await pool.query('SELECT region FROM vehicles WHERE id = $1', [vehicleB]);
    expect(rows.rows[0].region).toBe('RegionB');
  });
});

describe('platform domain isolation', () => {
  test('a tenant cannot enumerate other tenants', async () => {
    if (skip()) return;
    const rows = await asTenant(TENANT_A, (c) => c.query('SELECT id, name FROM tenants'));
    expect(rows.rows.map((r) => r.id)).toEqual([TENANT_A]);
  });

  test('a tenant cannot read platform_admins — Sonalit operators are not enumerable', async () => {
    if (skip()) return;
    const rows = await asTenant(TENANT_A, (c) => c.query('SELECT * FROM platform_admins'));
    expect(rows.rowCount).toBe(0);
  });

  test('a tenant cannot read the security event stream', async () => {
    if (skip()) return;
    await pool.query(
      `INSERT INTO security_events (action, result, scope, tenant_id)
       VALUES ('LOGIN','SUCCESS','TENANT',$1)`, [TENANT_A]);
    const rows = await asTenant(TENANT_A, (c) =>
      c.query('SELECT * FROM security_events WHERE tenant_id = $1', [TENANT_A]));
    // Append-only for tenants: they can write denials but never read them back.
    expect(rows.rowCount).toBe(0);
  });

  test('a tenant cannot read another tenant memberships', async () => {
    if (skip()) return;
    const rows = await asTenant(TENANT_A, (c) =>
      c.query('SELECT user_id FROM memberships WHERE tenant_id = $1', [TENANT_B]));
    expect(rows.rowCount).toBe(0);
  });

  test('a tenant cannot grant itself platform scope', async () => {
    if (skip()) return;
    const err = await expectRejected(asTenant(TENANT_A, (c) =>
      c.query(`INSERT INTO platform_admins (user_id, role, status)
               VALUES ($1,'PLATFORM_ADMIN','ACTIVE')`, [USER_A_ADMIN])));
    expect(err.code).toBe('42501');
  });

  test('platform scope can read the control plane', async () => {
    if (skip()) return;
    const rows = await asPlatform((c) =>
      c.query('SELECT id FROM tenants WHERE id = ANY($1)', [[TENANT_A, TENANT_B]]));
    expect(rows.rowCount).toBe(2);
  });

  test('platform scope alone does NOT expose tenant operational data', async () => {
    if (skip()) return;
    // withPlatform deliberately leaves app.current_org_id unset, so the control
    // plane is visible but no tenant's vehicles are. Reading a customer's data
    // requires scoping into that tenant, which is what support mode does.
    const rows = await asPlatform((c) =>
      c.query(`SELECT count(*)::int AS n FROM vehicles WHERE registration LIKE 'ISO-FIXTURE-%'`));
    expect(rows.rows[0].n).toBe(0);
  });
});

describe('cross-tenant referential integrity', () => {
  test('a membership cannot point at a tenant the user does not belong to', async () => {
    if (skip()) return;
    const err = await expectRejected(pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, is_primary)
       VALUES ($1, $2, 'admin', 'ACTIVE', TRUE)`,
      [USER_A_ADMIN, TENANT_B]
    ));
    expect(err.message).toMatch(/cross-tenant membership rejected/);
  });

  test('org_id must reference a registered tenant', async () => {
    if (skip()) return;
    const err = await expectRejected(pool.query(
      `INSERT INTO users (email, name, password_hash, role, org_id)
       VALUES ('ghost@fixture.test','Ghost','x','operator','99999999-9999-4999-8999-999999999999')`
    ));
    expect(err.code).toBe('23503'); // foreign key violation
  });
});

describe('RLS coverage', () => {
  test('every table carrying org_id has row level security enabled', async () => {
    if (skip()) return;
    const rows = await pool.query(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND NOT c.relrowsecurity
         AND EXISTS (
           SELECT 1 FROM information_schema.columns col
            WHERE col.table_name = c.relname AND col.column_name = 'org_id'
         )
       ORDER BY 1`);
    expect(rows.rows.map((r) => r.relname)).toEqual([]);
  });

  test('cds_gps_history partitions are individually protected', async () => {
    if (skip()) return;
    // A partition named directly is checked against its own policies, not the
    // parent's — so the partition name must not be a way around the parent.
    const rows = await pool.query(`
      SELECT c.relname, c.relrowsecurity
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname = 'cds_gps_history' AND c.relkind = 'r'`);
    expect(rows.rowCount).toBeGreaterThan(0);
    expect(rows.rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});
