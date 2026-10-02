const fs = require('fs');
const path = require('path');

const ROOTS = [
  path.join(__dirname, '../src/routes'),
  path.join(__dirname, '../src/controllers'),
  path.join(__dirname, '../src/workers'),
];
const SERVICE_ROOT = path.join(__dirname, '../../services');

function filesUnder(root, extensions = ['.js']) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(p, extensions));
    else if (extensions.includes(path.extname(entry.name))) out.push(p);
  }
  return out;
}

describe('tenant isolation regression guards', () => {
  test('query() fails closed without tenant context and globalQuery() cannot run inside one', async () => {
    const { query, globalQuery } = require('../src/config/database');
    const { runWithOrgContext } = require('../src/utils/tenantContext');
    await expect(query('SELECT 1')).rejects.toThrow('tenant_scope_required');
    await expect(
      runWithOrgContext('11111111-1111-4111-8111-111111111111', () => globalQuery('SELECT 1'))
    ).rejects.toThrow('global_query_forbidden_inside_tenant_context');
  });


  test('no request path has a fail-open req.db fallback', () => {
    const violations = [];
    for (const root of ROOTS) {
      for (const file of filesUnder(root)) {
        const source = fs.readFileSync(file, 'utf8');
        if (/req\.db\s*\|\|\s*query|query\s*\|\|\s*req\.db/.test(source)) {
          violations.push(path.relative(path.join(__dirname, '..'), file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('no HTTP route/controller directly uses the pool query API', () => {
    const violations = [];
    for (const root of ROOTS.slice(0, 2)) {
      for (const file of filesUnder(root)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const line of source.split(/\r?\n/)) {
          if (!/\bpool\.query\s*\(/.test(line)) continue;
          if (!/pool\.query\s*\(\s*['\`][^'\`]*REFRESH MATERIALIZED VIEW/i.test(line)) {
            violations.push(path.relative(path.join(__dirname, '..'), file));
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('tenant-bearing realtime publishes do not fall back to global channels', () => {
    const risky = [
      path.join(__dirname, '../src/workers/gpsWorker.js'),
      path.join(__dirname, '../src/workers/alertWorker.js'),
      path.join(__dirname, '../src/routes/guardian.js'),
    ];
    const violations = [];
    for (const file of risky) {
      const source = fs.readFileSync(file, 'utf8');
      const forbiddenSubjects = ['vehicle:update', 'alert:new', 'device:panic', 'geofence:violation'];
      const callerSuppliedSubject = forbiddenSubjects.some(subject => [
        `publish('${subject}'`,
        `publish("${subject}"`,
      ].some(pattern => source.includes(pattern)));
      if (callerSuppliedSubject) {
        violations.push(path.basename(file));
      }
    }
    expect(violations).toEqual([]);
  });


  test('tenant UUID validation accepts PostgreSQL UUIDs without RFC version bits', () => {
    const { normalizeOrgId } = require('../src/utils/tenantContext');
    expect(normalizeOrgId('00000000-0000-0000-0000-000000000001')).toBe('00000000-0000-0000-0000-000000000001');
    expect(normalizeOrgId('aaaaaaaa-0000-4000-a000-000000000001')).toBe('aaaaaaaa-0000-4000-a000-000000000001');
    expect(normalizeOrgId('not-a-uuid')).toBeNull();
    expect(normalizeOrgId('aaaaaaaa-0000-0000-0000-00000000000')).toBeNull();
  });

  test('background intelligence establishes tenant context before tenant queries', () => {
    const collection = fs.readFileSync(path.join(__dirname, '../src/utils/collectionFabric.js'), 'utf8');
    const regional = fs.readFileSync(path.join(__dirname, '../src/utils/regionalIncidentFabric.js'), 'utf8');
    expect(collection).toContain('runWithOrgContext(org_id');
    expect(regional).toContain('globalQuery(`SELECT DISTINCT org_id FROM users');
    expect(regional).toContain('runWithOrgContext(orgId');
  });

  test('tenant DB helper is fail-closed and RLS-aware', () => {
    const scoped = fs.readFileSync(path.join(__dirname, '../src/utils/orgScopedDb.js'), 'utf8');
    const database = fs.readFileSync(path.join(__dirname, '../src/config/database.js'), 'utf8');
    expect(scoped).toMatch(/SET LOCAL ROLE sonalit_app/);
    expect(scoped).toMatch(/tenant_scope_required/);
    expect(database).toMatch(/getOrgId/);
    expect(database).toMatch(/tenantQuery/);
    expect(database).toMatch(/SET LOCAL ROLE sonalit_app/);
    expect(database).toMatch(/app\.current_org_id/);
  });

  test('v4 HTTP routes never trust x-org-id or x-user-id headers as tenant identity', () => {
    const violations = [];
    for (const service of fs.existsSync(SERVICE_ROOT) ? fs.readdirSync(SERVICE_ROOT, { withFileTypes: true }) : []) {
      if (!service.isDirectory()) continue;
      const routesRoot = path.join(SERVICE_ROOT, service.name, 'src', 'routes');
      for (const file of filesUnder(routesRoot).map(f => f.replace(/\\/g, '/'))) {
        const source = fs.readFileSync(file, 'utf8');
        if (/headers\[['"]x-org-id['"]\]|headers\[['"]x-user-id['"]\]/i.test(source)) {
          violations.push(path.relative(path.join(__dirname, '../..'), file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('tenant hardening migration is structurally fail-closed', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261002_120_tenant_isolation_hardening.sql'), 'utf8');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('AS RESTRICTIVE');
    expect(sql).toContain('WITH CHECK');
    expect(sql).not.toMatch(/FULL OUTER JOIN\s+[^\n]+\bON\s+false/i);
    expect(sql).not.toMatch(/AS \$\s*\n/);

  });

  test('v4 service HTTP surfaces cannot trust caller-supplied tenant headers', () => {
    const serviceRoots = [
      path.join(__dirname, '../../services'),
    ];
    const violations = [];
    for (const serviceRoot of serviceRoots) {
      if (!fs.existsSync(serviceRoot)) continue;
      for (const service of fs.readdirSync(serviceRoot, { withFileTypes: true })) {
        if (!service.isDirectory()) continue;
        const routesRoot = path.join(serviceRoot, service.name, 'src');
        for (const scopeRoot of ['routes', 'middleware']) {
          for (const file of filesUnder(path.join(routesRoot, scopeRoot), ['.js', '.ts'])) {
            const source = fs.readFileSync(file, 'utf8');
            if (/req\s*\.\s*headers\[['"]x-org-id['"]\]|request\s*\.\s*headers\[['"]x-org-id['"]\]|x-org-id header required/i.test(source)) {
              violations.push(path.relative(path.join(__dirname, '../..'), file));
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('v4 service DB contexts use the canonical tenant GUC', () => {
    const serviceRoots = [
      path.join(__dirname, '../../services'),
    ];
    const violations = [];
    for (const serviceRoot of serviceRoots) {
      if (!fs.existsSync(serviceRoot)) continue;
      for (const service of fs.readdirSync(serviceRoot, { withFileTypes: true })) {
        if (!service.isDirectory()) continue;
        const file = path.join(serviceRoot, service.name, 'src/db.ts');
        if (!fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        if (/withOrgContext/.test(source) && !/app\.current_org_id/.test(source)) {
          violations.push(path.relative(path.join(__dirname, '../..'), file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('telemetry ingestion authenticates the device and never derives tenant from request body', () => {
    const file = path.join(__dirname, '../../services/telemetry-ingest-svc/src/routes/ingest.ts');
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toMatch(/preHandler:\s*deviceAuth/);
    expect(source).toMatch(/authenticatedDevice\.org_id/);
    expect(source).toMatch(/DEVICE_SCOPE_MISMATCH/);
    expect(source).toMatch(/withOrgContext\(org_id/);
  });


  test('rule notification NATS subject is tenant-qualified', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../services/alerts-svc/src/consumers/gps.ts'), 'utf8');
    expect(source).toContain('notifications.${orgId}.${action.channel}');
    expect(source).not.toContain('notifications.${action.channel}');
  });
  test('Guardian Convoy report realtime channel is tenant-qualified', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/routes/guardianConvoy.js'), 'utf8');
    expect(source).not.toContain('publish(`convoy:${report.convoy_id}:report`');
    expect(source).toContain('org:${req.cfo.org_id}:convoy:${report.convoy_id}:report');
  });
  test('realtime authorization never falls back from tenant to user identity', () => {
    const realtime = fs.readFileSync(path.join(__dirname, '../src/routes/realtime.js'), 'utf8');
    expect(realtime).toContain("if (!req.user?.org_id)");
    expect(realtime).not.toContain("req.user.org_id ?? req.user.id");
  });


  test('v4 service routes do not call raw pool.query directly', () => {
    const violations = [];
    const servicesRoot = path.join(__dirname, '../../services');
    if (!fs.existsSync(servicesRoot)) return;
    for (const service of fs.readdirSync(servicesRoot, { withFileTypes: true })) {
      if (!service.isDirectory()) continue;
      for (const scope of ['routes', 'middleware']) {
        for (const file of filesUnder(path.join(servicesRoot, service.name, 'src', scope), ['.js', '.ts'])) {
          const source = fs.readFileSync(file, 'utf8');
          const isHealthRoute = /(^|\/)health\.[jt]s$/.test(file);
          if (!isHealthRoute && /\bpool\.query\s*\(/.test(source)) {
            violations.push(path.relative(path.join(__dirname, '../..'), file));
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('offline mutation creation cannot override active tenant identity', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../apps/web/src/lib/offline/index.ts'), 'utf8');
    expect(source).toContain('offline_identity_mismatch');
    expect(source).toContain('input.ownerUserId !== identity.userId');
    expect(source).toContain('input.ownerOrgId !== identity.orgId');
  });

});