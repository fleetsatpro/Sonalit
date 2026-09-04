/**
 * Live-DB integration test for Ops Comms RLS.
 *
 * Requires DATABASE_URL and a database with migration 046 applied.
 * Skips gracefully if no DB is configured (matches rls.test.js's pattern).
 *
 * Proves:
 *   - Each org sees only its own channels/messages
 *   - Cross-org DELETE affects 0 rows
 *   - Cross-org INSERT is blocked by WITH CHECK (pg code 42501)
 *   - Attempting to bind a channel_member to a foreign org is blocked
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { withOrg } = require('../../src/utils/orgScopedDb');

const ORG_A = 'aaaacccc-0000-0000-0000-000000000001';
const ORG_B = 'bbbbcccc-0000-0000-0000-000000000001';
const USER_A = 'aaaacccc-0000-0000-0000-0000000000a1';
const USER_B = 'bbbbcccc-0000-0000-0000-0000000000b1';

let pool;
let chanA;
let chanB;

const skip = () => !process.env.DATABASE_URL;

beforeAll(async () => {
  if (skip()) return;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  // org_id is a foreign key to the tenant registry (migration 090), so the two
  // orgs these fixtures use have to exist before any row can reference them.
  await pool.query(
    `INSERT INTO tenants (id, name, slug, status, data_classification)
     VALUES ($1,'RLS Fixture A','rls-fixture-a','ACTIVE','PLATFORM_TEST'),
            ($2,'RLS Fixture B','rls-fixture-b','ACTIVE','PLATFORM_TEST')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );

  // Seed two org owners + one channel per org (superuser bypasses RLS).
  await pool.query(
    `INSERT INTO users (id, email, name, role, org_id, status, password_hash) VALUES
       ($1, 'a-rls@ex.test', 'A Admin', 'admin', $3, 'active', 'x'),
       ($2, 'b-rls@ex.test', 'B Admin', 'admin', $4, 'active', 'x')
     ON CONFLICT (id) DO NOTHING`,
    [USER_A, USER_B, ORG_A, ORG_B],
  );

  const a = await pool.query(
    `INSERT INTO channels (org_id, name, slug, type, created_by) VALUES ($1,'rls-a-general','rls-a-general','public',$2)
     ON CONFLICT (org_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [ORG_A, USER_A],
  );
  const b = await pool.query(
    `INSERT INTO channels (org_id, name, slug, type, created_by) VALUES ($1,'rls-b-general','rls-b-general','public',$2)
     ON CONFLICT (org_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [ORG_B, USER_B],
  );
  chanA = a.rows[0].id;
  chanB = b.rows[0].id;

  await pool.query(
    `INSERT INTO channel_members (channel_id, user_id, org_id, is_channel_admin) VALUES
       ($1, $2, $3, true), ($4, $5, $6, true)
     ON CONFLICT DO NOTHING`,
    [chanA, USER_A, ORG_A, chanB, USER_B, ORG_B],
  );
  await pool.query(
    `INSERT INTO messages (org_id, channel_id, author_id, body) VALUES
       ($1, $2, $3, 'ping from A'), ($4, $5, $6, 'ping from B')`,
    [ORG_A, chanA, USER_A, ORG_B, chanB, USER_B],
  );
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM channels WHERE slug IN ('rls-a-general', 'rls-b-general')`);
  await pool.query(`DELETE FROM users WHERE email IN ('a-rls@ex.test', 'b-rls@ex.test')`);
  await pool.end();
});

test('each org sees only its own channels', async () => {
  if (skip()) return;
  const a = await withOrg(ORG_A, (c) =>
    c.query(`SELECT slug FROM channels WHERE slug IN ('rls-a-general','rls-b-general')`),
  );
  const b = await withOrg(ORG_B, (c) =>
    c.query(`SELECT slug FROM channels WHERE slug IN ('rls-a-general','rls-b-general')`),
  );
  expect(a.rows.map((r) => r.slug)).toEqual(['rls-a-general']);
  expect(b.rows.map((r) => r.slug)).toEqual(['rls-b-general']);
});

test('each org sees only its own messages', async () => {
  if (skip()) return;
  const a = await withOrg(ORG_A, (c) => c.query(`SELECT body FROM messages WHERE body IN ('ping from A','ping from B')`));
  const b = await withOrg(ORG_B, (c) => c.query(`SELECT body FROM messages WHERE body IN ('ping from A','ping from B')`));
  expect(a.rows).toEqual([{ body: 'ping from A' }]);
  expect(b.rows).toEqual([{ body: 'ping from B' }]);
});

test('cross-org DELETE affects 0 rows', async () => {
  if (skip()) return;
  const del = await withOrg(ORG_A, (c) =>
    c.query(`DELETE FROM channels WHERE org_id = $1`, [ORG_B]),
  );
  expect(del.rowCount).toBe(0);
});

test('cross-org INSERT is blocked by WITH CHECK (pg 42501)', async () => {
  if (skip()) return;
  await expect(withOrg(ORG_A, (c) =>
    c.query(
      `INSERT INTO channels (org_id, name, slug, type) VALUES ($1, 'sneak', 'sneak', 'public')`,
      [ORG_B],
    ),
  )).rejects.toMatchObject({ code: '42501' });
});

test('cannot bind a channel_member row into a foreign org', async () => {
  if (skip()) return;
  await expect(withOrg(ORG_A, (c) =>
    c.query(
      `INSERT INTO channel_members (channel_id, user_id, org_id, is_channel_admin)
       VALUES ($1, $2, $3, true)`,
      [chanB, USER_A, ORG_B],
    ),
  )).rejects.toMatchObject({ code: '42501' });
});
