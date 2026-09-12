'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { connect: jest.fn(), end: jest.fn() },
  healthCheck: jest.fn().mockResolvedValue(true),
}));

const { authorize } = require('../src/middleware/auth');

function run(role, allowed) {
  const req = { user: { role, org_id: 'org-a', id: 'u1' } };
  let status = null;
  const res = {
    status(code) { status = code; return this; },
    json() { return this; },
  };
  let passed = false;
  authorize(...allowed)(req, res, () => { passed = true; });
  return { passed, status };
}

// authorize() has two doors: an exact match against the listed roles, and a
// fallback that admits any role whose ROLE_HIERARCHY level is >= a listed
// role's. Scoped field roles must only ever come through the first door — an
// entry in the hierarchy silently widens them to every route admitting an
// equal or lower rung.

describe('scoped field roles do not inherit through ROLE_HIERARCHY', () => {
  // The six convoy reporting routes in routes/convoys.js are all
  // authorize('admin','dispatcher','analyst') — level 1 via analyst.
  const REPORTING = ['admin', 'dispatcher', 'analyst'];

  for (const role of ['response_crew', 'handover_officer', 'yard_agent', 'port_agent']) {
    test(`${role} cannot reach convoy reporting routes`, () => {
      const { passed, status } = run(role, REPORTING);
      expect(passed).toBe(false);
      expect(status).toBe(403);
    });
  }

  test('response_crew still reaches its own routes by exact match', () => {
    expect(run('response_crew', ['admin', 'dispatcher', 'operator', 'response_crew']).passed).toBe(true);
    expect(run('response_crew', ['response_crew']).passed).toBe(true);
  });

  test('handover_officer still reaches convoy handover by exact match', () => {
    expect(run('handover_officer', ['admin', 'dispatcher', 'handover_officer']).passed).toBe(true);
  });

  test('the office ladder is untouched', () => {
    expect(run('admin', ['analyst']).passed).toBe(true);       // 4 >= 1
    expect(run('dispatcher', ['operator']).passed).toBe(true);  // 3 >= 2
    expect(run('operator', ['analyst']).passed).toBe(true);     // 2 >= 1
    expect(run('analyst', ['operator']).passed).toBe(false);    // 1 < 2
    expect(run('cfo', ['operator']).passed).toBe(false);        // 1 < 2
  });
});

// Anything VALID_ROLES accepts that users_role_check rejects is a 500 for
// whoever picks it in the admin create-user form. 'driver' was exactly that.
describe('VALID_ROLES agrees with the users_role_check constraint', () => {
  test('every role the API accepts is one the database allows', () => {
    const authSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');
    const listed = authSrc.match(/const VALID_ROLES = \[([^\]]+)\]/);
    expect(listed).not.toBeNull();
    const apiRoles = [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    const dir = path.join(__dirname, '..', 'migrations');
    const defining = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .filter((body) => /ADD\s+CONSTRAINT\s+users_role_check/i.test(body))
      .pop();
    expect(defining).toBeDefined();

    const clause = defining.match(/CHECK\s*\(\s*role\s+IN\s*\(([^)]+)\)/i);
    expect(clause).not.toBeNull();
    const dbRoles = [...clause[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(apiRoles.filter((r) => !dbRoles.includes(r))).toEqual([]);
  });
});
