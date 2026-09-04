/**
 * AI dispatch route — tenant isolation regression tests.
 *
 * These exist because every tool in src/routes/ai.js once used the global
 * query() helper from config/database, which bypasses row-level security.
 * The route mounted `authenticate` but never `attachOrgDb`, so
 * query_vehicles, query_convoys, query_alerts and query_risk_zones returned
 * rows for EVERY organisation to any authenticated user, and /anomalies and
 * /risk/:convoyId did the same.
 *
 * The guarantee under test: every tenant-data read on this router goes
 * through req.db (org-scoped, RLS enforced), and a request that somehow
 * arrives without an org scope is refused rather than served unscoped.
 */
'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  debug: jest.fn(),
}));

// The global pool/query is the RLS-bypassing path. Tests assert it is NEVER
// used for tenant data — only for the route's one-off DDL.
// Named with a `mock` prefix so Jest's hoisted module factory may close
// over it.
const mockGlobalQuery = jest.fn().mockResolvedValue({ rows: [] });
jest.mock('../src/config/database', () => ({
  pool: { connect: jest.fn() },
  query: mockGlobalQuery,
  healthCheck: jest.fn().mockResolvedValue(true),
}));

// The route mounts its own authenticate; these tests are about what happens
// AFTER a caller is authenticated, so it passes through and the harness
// below supplies req.user.
jest.mock('../src/middleware/auth', () => ({
  authenticate: (_req, _res, next) => {
    next();
  },
  authorize: () => (_req, _res, next) => {
    next();
  },
}));

// attachOrgDb is exercised for real elsewhere; here the harness installs a
// recording req.db before the router runs, so this must not overwrite it.
jest.mock('../src/utils/orgScopedDb', () => ({
  attachOrgDb: (_req, _res, next) => {
    next();
  },
  withOrg: jest.fn(),
}));

jest.mock('../src/utils/aiClient', () => ({
  hasAnthropic: () => false,
  hasGroqFallback: () => false,
  createMessage: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';

// Stands in for authenticate + attachOrgDb. `withOrg` records the org id
// each scoped query ran under, which is what the isolation assertions read.
function buildApp({ orgId = ORG_A, attachDb = true } = {}) {
  const scopedCalls = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_A, org_id: orgId, role: 'admin' };
    if (attachDb && orgId) {
      req.db = (text, params) => {
        scopedCalls.push({ orgId, text, params });
        return Promise.resolve({ rows: [] });
      };
    }
    next();
  });
  jest.isolateModules(() => {
    app.use('/ai', require('../src/routes/ai'));
  });
  return { app, scopedCalls };
}

beforeEach(() => {
  mockGlobalQuery.mockClear();
});

describe('AI route org scoping', () => {
  it('refuses a request that carries no org scope', async () => {
    const { app } = buildApp({ orgId: null, attachDb: false });

    const res = await request(app).get('/ai/anomalies');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'org_scope_required' });
  });

  it('reads anomalies through the org-scoped handle, not the global pool', async () => {
    const { app, scopedCalls } = buildApp();

    const res = await request(app).get('/ai/anomalies');

    expect(res.status).toBe(200);
    const alertReads = scopedCalls.filter((c) => /FROM alerts/i.test(c.text));
    expect(alertReads).toHaveLength(1);
    expect(alertReads[0].orgId).toBe(ORG_A);
    // Only DDL may use the unscoped pool.
    for (const call of mockGlobalQuery.mock.calls) {
      expect(call[0]).toMatch(/ALTER TABLE|CREATE TABLE/i);
    }
  });

  // Previously any tenant could read another tenant's convoy risk by id.
  // Scoped, the convoy is simply not visible and the route 404s.
  it('scopes convoy risk lookups so a foreign convoy is not found', async () => {
    const { app, scopedCalls } = buildApp();

    const res = await request(app).get('/ai/risk/11111111-2222-3333-4444-555555555555');

    expect(res.status).toBe(404);
    expect(scopedCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of scopedCalls) {
      expect(call.orgId).toBe(ORG_A);
    }
    for (const call of mockGlobalQuery.mock.calls) {
      expect(call[0]).toMatch(/ALTER TABLE|CREATE TABLE/i);
    }
  });
});

describe('AI route source hygiene', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../src/routes/ai.js'),
    'utf8',
  );

  // A guard against reintroduction: the unscoped helper is legitimate only
  // for the route's schema-bootstrap DDL. Any other use is a tenant leak.
  it('uses the unscoped query() only for DDL', () => {
    const calls = source.match(/await query\(\s*`?[^`;]*/g) || [];
    for (const call of calls) {
      expect(call).toMatch(/ALTER TABLE|CREATE TABLE/i);
    }
  });

  it('mounts attachOrgDb and the org scope guard', () => {
    expect(source).toMatch(/router\.use\(authenticate,\s*attachOrgDb\)/);
    expect(source).toContain('org_scope_required');
  });

  // Rows written with a NULL org_id are invisible to every tenant under RLS,
  // and rejected outright once the policy's WITH CHECK applies.
  it('writes org_id on every INSERT it performs', () => {
    const inserts = source.match(/INSERT INTO \w+ \([^)]*\)/g) || [];
    expect(inserts.length).toBeGreaterThan(0);
    for (const insert of inserts) {
      expect(insert).toContain('org_id');
    }
  });
});
