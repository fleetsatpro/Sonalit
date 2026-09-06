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

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = { id: 'admin-id', role: 'admin', status: 'active', org_id: 'org-a' };
    next();
  }),
  authorize: jest.fn(() => (_req, _res, next) => next()),
}));

const express = require('express');
const request = require('supertest');
const { query: mockQuery } = require('../src/config/database');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/handover-auth', require('../src/routes/handoverPin'));
  return app;
}

// ─── Tenant isolation ─────────────────────────────────────────────────────────
//
// handover_officer_pins is keyed by user_id alone: it carries no org_id, has no
// RLS policy, and these routes go through the raw pool rather than withOrg. The
// join to users is therefore the only thing scoping a row to a tenant, so these
// tests assert the caller's org_id actually reaches the query.

describe('handover PIN admin routes are org-scoped', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  test('GET /admin/pin-status/:userId scopes to the caller org', async () => {
    await request(makeApp())
      .get('/api/v1/handover-auth/admin/pin-status/other-org-user')
      .expect(200);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/JOIN\s+users/i);
    expect(sql).toMatch(/u\.org_id\s*=\s*\$2/);
    expect(params).toEqual(['other-org-user', 'org-a']);
  });

  test('POST /admin/unlock scopes to the caller org', async () => {
    await request(makeApp())
      .post('/api/v1/handover-auth/admin/unlock')
      .send({ user_id: 'other-org-user' })
      .expect(404);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/FROM\s+users/i);
    expect(sql).toMatch(/u\.org_id\s*=\s*\$2/);
    expect(params).toEqual(['other-org-user', 'org-a']);
  });

  test('POST /admin/unlock 404s rather than reporting success on no match', async () => {
    // The unscoped version returned {unlocked:true} unconditionally, so a
    // cross-org attempt looked identical to a real one.
    const res = await request(makeApp())
      .post('/api/v1/handover-auth/admin/unlock')
      .send({ user_id: 'other-org-user' });

    expect(res.status).toBe(404);
    expect(res.body.data).toBeUndefined();
  });

  test('POST /admin/reset-pin scopes to the caller org', async () => {
    await request(makeApp())
      .post('/api/v1/handover-auth/admin/reset-pin')
      .send({ user_id: 'other-org-user' })
      .expect(404);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/org_id\s*=\s*\$2/);
    expect(params).toEqual(['other-org-user', 'org-a']);
  });
});

// ─── users.role constraint ────────────────────────────────────────────────────
//
// 077 renamed the live constraint to users_role_cfo_check, so the
// "DROP CONSTRAINT IF EXISTS users_role_check" in 082 and 083 matched nothing
// and the narrow constraint survived beside the wide one. Postgres ANDs CHECK
// constraints, so the effective set was the narrow one and no handover_officer
// or response_crew could be inserted — which made every route in this file
// unreachable. Guard the migration set so a future migration cannot quietly
// reintroduce a second, narrower constraint.

describe('users.role migration constraints', () => {
  const dir = path.join(__dirname, '..', 'migrations');
  const sql = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, body: fs.readFileSync(path.join(dir, f), 'utf8') }));

  // Every ADD CONSTRAINT <name> CHECK (role IN ...) across the migration set,
  // in application order, paired with the drops that precede it.
  function constraintTimeline() {
    const live = new Set();
    for (const { body } of sql) {
      for (const line of body.split('\n')) {
        const drop = line.match(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
        if (drop) live.delete(drop[1].toLowerCase());
        const add = line.match(/ADD\s+CONSTRAINT\s+(\w+)/i);
        if (add) live.add(add[1].toLowerCase());
      }
    }
    return live;
  }

  test('exactly one role CHECK constraint survives the migration set', () => {
    const roleConstraints = [...constraintTimeline()].filter((n) => n.includes('role'));
    expect(roleConstraints).toEqual(['users_role_check']);
  });

  test('the surviving constraint admits every role the app assigns', () => {
    // The last migration to define users_role_check wins.
    const defining = sql
      .filter(({ body }) => /ADD\s+CONSTRAINT\s+users_role_check/i.test(body))
      .pop();
    expect(defining).toBeDefined();

    for (const role of [
      'admin', 'dispatcher', 'operator', 'analyst', 'cfo',
      'yard_agent', 'port_agent', 'response_crew', 'handover_officer',
    ]) {
      expect(defining.body).toContain(`'${role}'`);
    }
  });
});
