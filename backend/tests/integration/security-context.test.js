/**
 * Security context resolution, support mode and tenant lifecycle.
 *
 * The database suite (tenant-isolation.test.js) proves the storage boundary
 * holds. This one proves the layer above it: that scope, tenant and permissions
 * are derived server-side, that a client cannot talk its way into another
 * tenant by asking, and that suspension and support mode behave as specified.
 *
 * Requires DATABASE_URL and skips cleanly without one.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Pool } = require('pg');
const { resolveSecurityContext } = require('../../src/security/context');
const supportMode = require('../../src/services/supportMode');

const skip = () => !process.env.DATABASE_URL;

const TENANT_A = 'aaaaaaaa-1111-4000-8000-00000000000a';
const TENANT_B = 'bbbbbbbb-1111-4000-8000-00000000000b';
const TENANT_SUSP = 'cccccccc-1111-4000-8000-00000000000c';

const U_PLATFORM = 'dddddddd-1111-4000-8000-000000000001';
const U_SUPPORT = 'dddddddd-1111-4000-8000-000000000002';
const U_A = 'dddddddd-1111-4000-8000-00000000000a';
const U_B = 'dddddddd-1111-4000-8000-00000000000b';
const U_SUSP = 'dddddddd-1111-4000-8000-00000000000c';

let pool;

const userRow = (id, role) => ({ id, role });

beforeAll(async () => {
  if (skip()) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

  await pool.query(
    `INSERT INTO tenants (id, name, slug, status, data_classification, enabled_modules)
     VALUES ($1,'Ctx A','ctx-a','ACTIVE','TENANT',ARRAY['FLEET','CONVOY','GPS','ALERTS','REPORTING']),
            ($2,'Ctx B','ctx-b','ACTIVE','TENANT',ARRAY['FLEET','CDS']),
            ($3,'Ctx Susp','ctx-susp','SUSPENDED','TENANT',ARRAY['FLEET'])
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, enabled_modules = EXCLUDED.enabled_modules`,
    [TENANT_A, TENANT_B, TENANT_SUSP]
  );

  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, role, status, org_id)
     VALUES ($1,'ctx-plat@fixture.test','Plat','x','admin','active',$6),
            ($2,'ctx-supp@fixture.test','Supp','x','admin','active',$6),
            ($3,'ctx-a@fixture.test','A','x','admin','active',$6),
            ($4,'ctx-b@fixture.test','B','x','dispatcher','active',$7),
            ($5,'ctx-susp@fixture.test','S','x','operator','active',$8)
     ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, status = 'active'`,
    [U_PLATFORM, U_SUPPORT, U_A, U_B, U_SUSP, TENANT_A, TENANT_B, TENANT_SUSP]
  );

  await pool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, status)
     VALUES ($1,$4,'admin','ACTIVE'), ($2,$5,'dispatcher','ACTIVE'), ($3,$6,'operator','ACTIVE')
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET status='ACTIVE', role = EXCLUDED.role`,
    [U_A, U_B, U_SUSP, TENANT_A, TENANT_B, TENANT_SUSP]
  );

  await pool.query(
    `INSERT INTO platform_admins (user_id, role, status)
     VALUES ($1,'PLATFORM_ADMIN','ACTIVE'), ($2,'PLATFORM_SUPPORT','ACTIVE')
     ON CONFLICT (user_id) DO UPDATE SET status='ACTIVE', role = EXCLUDED.role, revoked_at = NULL`,
    [U_PLATFORM, U_SUPPORT]
  );
});

afterAll(async () => {
  if (skip() || !pool) return;
  const tenants = [TENANT_A, TENANT_B, TENANT_SUSP];
  await pool.query('DELETE FROM support_sessions WHERE tenant_id = ANY($1)', [tenants]);
  await pool.query('DELETE FROM security_events WHERE tenant_id = ANY($1)', [tenants]);
  await pool.query('DELETE FROM platform_admins WHERE user_id = ANY($1)', [[U_PLATFORM, U_SUPPORT]]);
  await pool.query('DELETE FROM memberships WHERE tenant_id = ANY($1)', [tenants]);
  await pool.query("DELETE FROM users WHERE email LIKE 'ctx-%@fixture.test'");
  await pool.query('DELETE FROM tenants WHERE id = ANY($1)', [tenants]);
  await pool.end();
});

describe('tenant context is server-derived', () => {
  test('a customer resolves into its own tenant with its membership role', async () => {
    if (skip()) return;
    const ctx = await resolveSecurityContext(userRow(U_A, 'admin'));
    expect(ctx.scope).toBe('TENANT');
    expect(ctx.tenantId).toBe(TENANT_A);
    expect(ctx.role).toBe('admin');
    expect(ctx.membershipId).toBeTruthy();
  });

  test('asking for another tenant yields no context at all', async () => {
    if (skip()) return;
    // The header is only ever a navigation hint. There is no membership for
    // this user in tenant B, so resolution fails rather than honouring it.
    const ctx = await resolveSecurityContext(userRow(U_A, 'admin'), { requestedTenantId: TENANT_B });
    expect(ctx).toBeNull();
  });

  test('the role on the user row does not override the membership role', async () => {
    if (skip()) return;
    // Even claiming to be an admin, the resolved role comes from the membership.
    const ctx = await resolveSecurityContext(userRow(U_B, 'admin'));
    expect(ctx.role).toBe('dispatcher');
    expect(ctx.permissions).not.toContain('users.manage');
  });

  test('permissions reflect the tenant module entitlements', async () => {
    if (skip()) return;
    const a = await resolveSecurityContext(userRow(U_A, 'admin'));
    const b = await resolveSecurityContext(userRow(U_B, 'dispatcher'));

    // Tenant A has no CDS module; tenant B does.
    expect(a.permissions).not.toContain('cds.read');
    expect(a.permissions).toContain('convoys.write');
    expect(b.permissions).toContain('cds.read');
    expect(b.permissions).not.toContain('convoys.write'); // B has no CONVOY module
  });
});

describe('tenant lifecycle', () => {
  test('a suspended tenant still resolves, carrying its status for the guard', async () => {
    if (skip()) return;
    const ctx = await resolveSecurityContext(userRow(U_SUSP, 'operator'));
    expect(ctx.tenantStatus).toBe('SUSPENDED');
  });

  test('suspending a tenant is visible on the very next resolution', async () => {
    if (skip()) return;
    let ctx = await resolveSecurityContext(userRow(U_A, 'admin'));
    expect(ctx.tenantStatus).toBe('ACTIVE');

    await pool.query("UPDATE tenants SET status='SUSPENDED' WHERE id=$1", [TENANT_A]);
    ctx = await resolveSecurityContext(userRow(U_A, 'admin'));
    expect(ctx.tenantStatus).toBe('SUSPENDED');

    await pool.query("UPDATE tenants SET status='ACTIVE' WHERE id=$1", [TENANT_A]);
  });

  test('a revoked membership stops resolving immediately', async () => {
    if (skip()) return;
    await pool.query(
      "UPDATE memberships SET status='REVOKED', revoked_at=NOW() WHERE user_id=$1", [U_B]);

    const ctx = await resolveSecurityContext(userRow(U_B, 'dispatcher'));
    // Falls through to the legacy users.org_id path, which is still a real
    // authorization: the tenant exists and is ACTIVE. What matters is that the
    // revoked membership itself grants nothing.
    expect(ctx === null || ctx.membershipId === null).toBe(true);

    await pool.query(
      "UPDATE memberships SET status='ACTIVE', revoked_at=NULL WHERE user_id=$1", [U_B]);
  });
});

describe('platform scope', () => {
  test('a platform admin resolves to PLATFORM with no tenant selected', async () => {
    if (skip()) return;
    const ctx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'));
    expect(ctx.scope).toBe('PLATFORM');
    expect(ctx.tenantId).toBeNull();
    expect(ctx.role).toBe('PLATFORM_ADMIN');
  });

  test('a platform admin cannot reach a tenant just by asking for it', async () => {
    if (skip()) return;
    // Without an open support session this must deny rather than silently
    // granting platform-wide scope — otherwise the header would be a way into
    // customer data with nothing recorded.
    const ctx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'), {
      requestedTenantId: TENANT_A,
    });
    expect(ctx).toBeNull();
  });

  test('a customer cannot become a platform admin by claiming the role', async () => {
    if (skip()) return;
    // The role on the passed user row is attacker-controlled in the threat
    // model; platform scope comes from platform_admins alone.
    const ctx = await resolveSecurityContext(
      { id: U_A, role: 'PLATFORM_ADMIN' },
    );
    expect(ctx.scope).toBe('TENANT');
    expect(ctx.tenantId).toBe(TENANT_A);
  });
});

describe('support mode', () => {
  let sessionId;

  test('a session scopes the operator into exactly one tenant, read-only', async () => {
    if (skip()) return;
    const platformCtx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'));

    const session = await supportMode.startSupportSession({
      context: platformCtx,
      tenantId: TENANT_A,
      reason: 'Investigating convoy alert escalation',
    });
    sessionId = session.id;

    expect(session.access_level).toBe('READ_ONLY');

    const scoped = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'), {
      requestedTenantId: TENANT_A,
    });
    expect(scoped.scope).toBe('PLATFORM');
    expect(scoped.tenantId).toBe(TENANT_A);
    expect(scoped.readOnly).toBe(true);
    expect(scoped.support.reason).toBe('Investigating convoy alert escalation');
  });

  test('a session for tenant A does not open tenant B', async () => {
    if (skip()) return;
    const ctx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'), {
      requestedTenantId: TENANT_B,
    });
    expect(ctx).toBeNull();
  });

  test('the session is recorded in the security event stream', async () => {
    if (skip()) return;
    const rows = await pool.query(
      `SELECT action, result, tenant_id FROM security_events
        WHERE action = 'SUPPORT_MODE_STARTED' AND tenant_id = $1`, [TENANT_A]);
    expect(rows.rowCount).toBeGreaterThan(0);
    expect(rows.rows[0].result).toBe('SUCCESS');
  });

  test('a short reason is refused', async () => {
    if (skip()) return;
    const platformCtx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'));
    await expect(supportMode.startSupportSession({
      context: platformCtx, tenantId: TENANT_A, reason: 'why',
    })).rejects.toThrow(/at least 10 characters/);
  });

  test('PLATFORM_SUPPORT cannot open a write session', async () => {
    if (skip()) return;
    const supportCtx = await resolveSecurityContext(userRow(U_SUPPORT, 'admin'));
    expect(supportCtx.role).toBe('PLATFORM_SUPPORT');

    await expect(supportMode.startSupportSession({
      context: supportCtx,
      tenantId: TENANT_A,
      reason: 'Attempting a write session without authority',
      accessLevel: 'READ_WRITE',
    })).rejects.toThrow(/PLATFORM_ADMIN/);
  });

  test('a customer cannot open a support session', async () => {
    if (skip()) return;
    const tenantCtx = await resolveSecurityContext(userRow(U_A, 'admin'));
    await expect(supportMode.startSupportSession({
      context: tenantCtx,
      tenantId: TENANT_B,
      reason: 'Trying to reach another customer account',
    })).rejects.toThrow(/platform scope required/);
  });

  test('an expired session stops granting access without any sweeper', async () => {
    if (skip()) return;
    // Age the whole window rather than just the expiry — support_session_window
    // requires expires_at > started_at, so a session can never be stored with an
    // expiry that precedes its own start.
    await pool.query(
      `UPDATE support_sessions
          SET started_at = NOW() - INTERVAL '2 hours',
              expires_at = NOW() - INTERVAL '1 minute'
        WHERE id = $1`,
      [sessionId]);

    const ctx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'), {
      requestedTenantId: TENANT_A,
    });
    expect(ctx).toBeNull();
  });

  test('ending a session revokes the tenant scope', async () => {
    if (skip()) return;
    const platformCtx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'));
    const fresh = await supportMode.startSupportSession({
      context: platformCtx, tenantId: TENANT_A, reason: 'Second look at the same incident',
    });

    let ctx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'), { requestedTenantId: TENANT_A });
    expect(ctx.tenantId).toBe(TENANT_A);

    await supportMode.endSupportSession({ context: platformCtx, sessionId: fresh.id });

    ctx = await resolveSecurityContext(userRow(U_PLATFORM, 'admin'), { requestedTenantId: TENANT_A });
    expect(ctx).toBeNull();
  });
});
