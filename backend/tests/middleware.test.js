'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = '';

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { connect: jest.fn(), end: jest.fn() },
  healthCheck: jest.fn().mockResolvedValue(true),
}));

const { query: mockQuery } = require('../src/config/database');
const responseEnvelope = require('../src/middleware/responseEnvelope');
const requireIdempotencyKey = require('../src/middleware/idempotency');
const csrf = require('../src/middleware/csrf');

// ─── responseEnvelope ─────────────────────────────────────────────────────────

describe('responseEnvelope middleware', () => {
  function makeRes() {
    const res = { json: jest.fn() };
    return res;
  }

  test('adds res.envelope helper', () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();
    responseEnvelope(req, res, next);
    expect(typeof res.envelope).toBe('function');
    expect(next).toHaveBeenCalled();
  });

  test('envelope wraps data without meta', () => {
    const req = {};
    const res = makeRes();
    responseEnvelope(req, res, () => {});
    res.envelope([1, 2, 3]);
    expect(res.json).toHaveBeenCalledWith({ data: [1, 2, 3] });
  });

  test('envelope includes meta when provided', () => {
    const req = {};
    const res = makeRes();
    responseEnvelope(req, res, () => {});
    res.envelope([1], { total: 1, limit: 50 });
    expect(res.json).toHaveBeenCalledWith({ data: [1], meta: { total: 1, limit: 50 } });
  });
});

// ─── requireIdempotencyKey ────────────────────────────────────────────────────

describe('requireIdempotencyKey middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls next() when no X-Idempotency-Key header', async () => {
    const req = { headers: {}, user: { org_id: 'org-1' } };
    const res = {};
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 10));
    expect(next).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns cached response when key already stored', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ status_code: 201, response: { data: { id: 'abc' } } }],
    });
    const req = { headers: { 'x-idempotency-key': 'idem-key-1' }, user: { org_id: 'org-1' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'abc' } });
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() and wraps res.json when key not in cache', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = { headers: { 'x-idempotency-key': 'idem-key-2' }, user: { org_id: 'org-1' } };
    const origJson = jest.fn();
    const res = { statusCode: 200, json: origJson };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    expect(next).toHaveBeenCalled();
    expect(typeof res.json).toBe('function');
    expect(res.json).not.toBe(origJson);
  });

  test('uses anonymous org_id when req.user is not set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = { headers: { 'x-idempotency-key': 'idem-key-3' } };
    const res = { statusCode: 200, json: jest.fn() };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE key = $1'),
      ['idem-key-3', 'anonymous']
    );
  });
});

// ─── csrf middleware ──────────────────────────────────────────────────────────

describe('csrf middleware', () => {
  function makeCtx({ method = 'GET', path = '/api/v1/vehicles', cookies = {}, headers = {} } = {}) {
    const setCookies = [];
    const res = {
      cookie: jest.fn((name, val, opts) => setCookies.push({ name, val, opts })),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      _setCookies: setCookies,
    };
    return { req: { method, path, cookies, headers }, res, next: jest.fn() };
  }

  test('sets csrf cookie when absent on GET', () => {
    const { req, res, next } = makeCtx({ method: 'GET' });
    csrf(req, res, next);
    expect(res.cookie).toHaveBeenCalledWith(expect.stringContaining('csrf'), expect.any(String), expect.objectContaining({ sameSite: 'strict' }));
    expect(next).toHaveBeenCalled();
  });

  test('allows GET without validation', () => {
    const token = 'abc123';
    const { req, res, next } = makeCtx({ method: 'GET', cookies: { csrf: token } });
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects POST without X-CSRF-Token header', () => {
    const token = 'deadbeef'.repeat(8);
    const { req, res, next } = makeCtx({ method: 'POST', cookies: { csrf: token } });
    csrf(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects POST when header does not match cookie', () => {
    const token = 'deadbeef'.repeat(8);
    const { req, res, next } = makeCtx({
      method: 'POST',
      cookies: { csrf: token },
      headers: { 'x-csrf-token': 'wrongtoken'.repeat(6) },
    });
    csrf(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows POST when header matches cookie', () => {
    const token = 'a'.repeat(64);
    const { req, res, next } = makeCtx({
      method: 'POST',
      cookies: { csrf: token },
      headers: { 'x-csrf-token': token },
    });
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('skips validation for guardian device paths', () => {
    const { req, res, next } = makeCtx({ method: 'POST', path: '/api/v1/guardian/enroll' });
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('skips validation for webhook paths', () => {
    const { req, res, next } = makeCtx({ method: 'POST', path: '/api/v1/webhooks/convoy' });
    csrf(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
