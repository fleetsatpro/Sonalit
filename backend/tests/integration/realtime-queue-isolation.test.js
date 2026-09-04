/**
 * Realtime channel and background-job isolation — against a real database.
 *
 * The channel grammar and the job verifier both resolve ownership through the
 * tenant-scoped pool, so they can only be tested honestly with RLS actually
 * running. Fixtures build two tenants with their own devices, convoys and comms
 * channels, then attempt every cross-tenant subscription and forged job.
 *
 * Requires DATABASE_URL and skips cleanly without one.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { authorizeChannel } = require('../../src/security/channels');
const { verifyJobTenant, idempotencyKey } = require('../../src/security/jobs');

const skip = () => !process.env.DATABASE_URL;

const TENANT_A = 'aaaaaaaa-2222-4000-8000-00000000000a';
const TENANT_B = 'bbbbbbbb-2222-4000-8000-00000000000b';
const USER_A = 'dddddddd-2222-4000-8000-00000000000a';
const USER_B = 'dddddddd-2222-4000-8000-00000000000b';

let pool;
let deviceA;
let deviceB;
let convoyA;
let convoyB;
let commsA;

/** A tenant security context of the shape resolveSecurityContext produces. */
const ctx = (tenantId, userId, permissions) => ({
  userId,
  scope: 'TENANT',
  tenantId,
  membershipId: null,
  role: 'admin',
  permissions,
  enabledModules: ['FLEET', 'CONVOY', 'GPS', 'ALERTS', 'REPORTING'],
  tenantStatus: 'ACTIVE',
  support: null,
  readOnly: false,
});

const FULL = ['gps.read', 'alerts.read', 'alerts.manage', 'reports.read', 'convoys.read'];

beforeAll(async () => {
  if (skip()) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

  await pool.query(
    `INSERT INTO tenants (id, name, slug, status, data_classification)
     VALUES ($1,'RT A','rt-a','ACTIVE','PLATFORM_TEST'), ($2,'RT B','rt-b','ACTIVE','PLATFORM_TEST')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B]
  );

  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, role, status, org_id)
     VALUES ($1,'rt-a@fixture.test','RT A','x','admin','active',$3),
            ($2,'rt-b@fixture.test','RT B','x','admin','active',$4)
     ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id`,
    [USER_A, USER_B, TENANT_A, TENANT_B]
  );

  const dA = await pool.query(
    `INSERT INTO guardian_devices (org_id, name) VALUES ($1,'RT Device A') RETURNING id`, [TENANT_A]);
  const dB = await pool.query(
    `INSERT INTO guardian_devices (org_id, name) VALUES ($1,'RT Device B') RETURNING id`, [TENANT_B]);
  deviceA = dA.rows[0].id;
  deviceB = dB.rows[0].id;

  const cA = await pool.query(
    `INSERT INTO convoys (name, region, status, org_id) VALUES ('RT Convoy A','R','planned',$1) RETURNING id`, [TENANT_A]);
  const cB = await pool.query(
    `INSERT INTO convoys (name, region, status, org_id) VALUES ('RT Convoy B','R','planned',$1) RETURNING id`, [TENANT_B]);
  convoyA = cA.rows[0].id;
  convoyB = cB.rows[0].id;

  const chA = await pool.query(
    `INSERT INTO channels (org_id, name, slug, type, created_by) VALUES ($1,'rt-a-chan','rt-a-chan','public',$2)
     ON CONFLICT (org_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_A, USER_A]);
  commsA = chA.rows[0].id;
  await pool.query(
    `INSERT INTO channel_members (channel_id, user_id, org_id) VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING`, [commsA, USER_A, TENANT_A]);
});

afterAll(async () => {
  if (skip() || !pool) return;
  const tenants = [TENANT_A, TENANT_B];
  await pool.query('DELETE FROM channel_members WHERE org_id = ANY($1)', [tenants]);
  await pool.query('DELETE FROM channels WHERE org_id = ANY($1)', [tenants]);
  await pool.query('DELETE FROM convoys WHERE org_id = ANY($1)', [tenants]);
  await pool.query('DELETE FROM guardian_devices WHERE org_id = ANY($1)', [tenants]);
  await pool.query('DELETE FROM security_events WHERE tenant_id = ANY($1)', [tenants]);
  await pool.query("DELETE FROM users WHERE email LIKE 'rt-%@fixture.test'");
  await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
  await pool.end();
});

describe('realtime channel authorization — own tenant', () => {
  test('a member may join its own org broadcast', async () => {
    if (skip()) return;
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `org#${TENANT_A}`);
    expect(d.ok).toBe(true);
  });

  test('a member may join a device channel for its own device', async () => {
    if (skip()) return;
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `org:${TENANT_A}:device:${deviceA}:telemetry`);
    expect(d.ok).toBe(true);
  });

  test('a member of a comms channel may join it', async () => {
    if (skip()) return;
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `org#${TENANT_A}#comms#${commsA}`);
    expect(d.ok).toBe(true);
  });

  test('a convoy report channel resolves through ownership', async () => {
    if (skip()) return;
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `convoy:${convoyA}:report`);
    expect(d.ok).toBe(true);
  });
});

describe('realtime channel authorization — cross tenant is refused', () => {
  test("A cannot join B's org broadcast", async () => {
    if (skip()) return;
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `org#${TENANT_B}`);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('tenant_mismatch');
  });

  test("A cannot join B's device telemetry, even naming B's tenant correctly", async () => {
    if (skip()) return;
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `org:${TENANT_B}:device:${deviceB}:telemetry`);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('tenant_mismatch');
  });

  test("A cannot reach B's device by putting its own tenant in the channel name", async () => {
    if (skip()) return;
    // The tenant segment matches, so the only thing left is ownership — and
    // the lookup runs under RLS, so B's device is simply not there.
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `org:${TENANT_A}:device:${deviceB}:telemetry`);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('forbidden');
  });

  test("A cannot join B's convoy report channel (no tenant in the name at all)", async () => {
    if (skip()) return;
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `convoy:${convoyB}:report`);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('forbidden');
  });

  test("A cannot join a comms channel it is not a member of", async () => {
    if (skip()) return;
    const outsider = ctx(TENANT_A, USER_B, FULL); // in tenant A, but not a channel member
    const d = await authorizeChannel(outsider, `org#${TENANT_A}#comms#${commsA}`);
    expect(d.ok).toBe(false);
  });

  test("A cannot join B's alert and panic channels", async () => {
    if (skip()) return;
    for (const channel of [`alert:${TENANT_B}`, `panic:${TENANT_B}`, `risk:updates:${TENANT_B}`]) {
      const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), channel);
      expect({ channel, ok: d.ok }).toEqual({ channel, ok: false });
    }
  });
});

describe('realtime channel authorization — shape and permissions', () => {
  test('an unknown channel shape is refused, not passed through', () => {
    if (skip()) return;
    return Promise.all(
      ['vehicle:update', 'device:location', 'device:panic', '*', 'org#*', '', 'admin']
        .map(async (channel) => {
          const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), channel);
          expect({ channel, ok: d.ok }).toEqual({ channel, ok: false });
        })
    );
  });

  test('a wildcard cannot stand in for a tenant id', async () => {
    if (skip()) return;
    const d = await authorizeChannel(ctx(TENANT_A, USER_A, FULL), 'org#*');
    expect(d.ok).toBe(false);
  });

  test('a channel needing a permission the role lacks is refused', async () => {
    if (skip()) return;
    const noGps = ctx(TENANT_A, USER_A, ['alerts.read']);
    const d = await authorizeChannel(noGps, `org:${TENANT_A}:device:${deviceA}:telemetry`);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('forbidden');
  });

  test('a context with no tenant resolves nothing', async () => {
    if (skip()) return;
    const platform = { ...ctx(TENANT_A, USER_A, FULL), scope: 'PLATFORM', tenantId: null };
    const d = await authorizeChannel(platform, `org#${TENANT_A}`);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('no_tenant_context');
  });

  test('a refused subscription is recorded in the security stream', async () => {
    if (skip()) return;
    await authorizeChannel(ctx(TENANT_A, USER_A, FULL), `org#${TENANT_B}`);
    const rows = await pool.query(
      `SELECT action, result FROM security_events
        WHERE tenant_id = $1 AND resource_type = 'realtime_channel' AND result = 'DENIED'
        ORDER BY occurred_at DESC LIMIT 1`, [TENANT_A]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].action).toBe('CROSS_TENANT_ATTEMPT');
  });
});

describe('background job tenant verification', () => {
  const job = (orgId, extra = {}) => ({ name: 'test-job', id: 'j1', data: { orgId, ...extra } });

  test('a job naming its own resource is accepted', async () => {
    if (skip()) return;
    expect(await verifyJobTenant(job(TENANT_A), { table: 'convoys', id: convoyA })).toBe(true);
  });

  test("a job claiming tenant A while naming B's resource is refused", async () => {
    if (skip()) return;
    // The forged-job case: payload fields are attacker-choosable, so ownership
    // is re-derived from the database instead of believed.
    expect(await verifyJobTenant(job(TENANT_A), { table: 'convoys', id: convoyB })).toBe(false);
  });

  test("a job claiming tenant B while naming A's resource is refused", async () => {
    if (skip()) return;
    expect(await verifyJobTenant(job(TENANT_B), { table: 'convoys', id: convoyA })).toBe(false);
  });

  test('a job with no tenant is refused', async () => {
    if (skip()) return;
    expect(await verifyJobTenant(job(null), { table: 'convoys', id: convoyA })).toBe(false);
  });

  test('a job naming a device across tenants is refused', async () => {
    if (skip()) return;
    expect(await verifyJobTenant(job(TENANT_A), { table: 'guardian_devices', id: deviceA })).toBe(true);
    expect(await verifyJobTenant(job(TENANT_A), { table: 'guardian_devices', id: deviceB })).toBe(false);
  });

  test('a refused job is recorded in the security stream', async () => {
    if (skip()) return;
    await verifyJobTenant(job(TENANT_A), { table: 'convoys', id: convoyB });
    const rows = await pool.query(
      `SELECT action, result FROM security_events
        WHERE tenant_id = $1 AND resource_type = 'convoys' AND result = 'DENIED'
        ORDER BY occurred_at DESC LIMIT 1`, [TENANT_A]);
    expect(rows.rowCount).toBe(1);
  });

  test('an unsafe table identifier is rejected rather than interpolated', async () => {
    if (skip()) return;
    await expect(verifyJobTenant(job(TENANT_A), { table: 'convoys; DROP TABLE users', id: convoyA }))
      .rejects.toThrow(/unsafe identifier/);
  });
});

describe('job idempotency keys', () => {
  test('the same logical job yields the same key', () => {
    const a = idempotencyKey(TENANT_A, 'report', { convoyId: 'c1', day: '2026-09-01' });
    const b = idempotencyKey(TENANT_A, 'report', { convoyId: 'c1', day: '2026-09-01' });
    expect(a).toBe(b);
  });

  test('the same job in a different tenant yields a different key', () => {
    // Otherwise one tenant's enqueue would deduplicate another's away.
    const a = idempotencyKey(TENANT_A, 'report', { convoyId: 'c1' });
    const b = idempotencyKey(TENANT_B, 'report', { convoyId: 'c1' });
    expect(a).not.toBe(b);
  });

  test('different work yields a different key', () => {
    const a = idempotencyKey(TENANT_A, 'report', { convoyId: 'c1' });
    const b = idempotencyKey(TENANT_A, 'report', { convoyId: 'c2' });
    expect(a).not.toBe(b);
  });
});
