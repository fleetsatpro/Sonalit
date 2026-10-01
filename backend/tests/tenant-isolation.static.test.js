const fs = require('fs');
const path = require('path');

const ROOTS = [
  path.join(__dirname, '../src/routes'),
  path.join(__dirname, '../src/controllers'),
  path.join(__dirname, '../src/workers'),
];

function filesUnder(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('tenant isolation regression guards', () => {
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
        if (/\bpool\.query\s*\(/.test(source)) {
          violations.push(path.relative(path.join(__dirname, '..'), file));
        }
      }
    }
    expect(violations).toEqual([]);
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

  test('tenant hardening migration is structurally fail-closed', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261002_120_tenant_isolation_hardening.sql'), 'utf8');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('AS RESTRICTIVE');
    expect(sql).toContain('WITH CHECK');
    expect(sql).not.toMatch(/FULL OUTER JOIN\s+[^\n]+\bON\s+false/i);
    expect(sql).not.toMatch(/AS \$\s*\n/);
  });
});
