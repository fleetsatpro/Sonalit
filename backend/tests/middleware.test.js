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

  function clientWithCached(rows = []) {
    const client = {
      query: jest.fn(async sql => {
        if (sql.includes('SELECT status_code, response FROM idempotency_keys')) return { rows };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    return client;
  }

  function responseWithEvents() {
    const listeners = new Map();
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      once(event, callback) {
        const callbacks = listeners.get(event) ?? [];
        callbacks.push(callback);
        listeners.set(event, callbacks);
        return this;
      },
      emit(event) {
        for (const callback of listeners.get(event) ?? []) callback();
      },
    };
    return res;
  }

  test('calls next() without acquiring a connection when no key is supplied', () => {
    const req = { headers: {}, user: { org_id: 'org-1' } };
    const res = {};
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns a cached response after acquiring the tenant-key advisory lock', async () => {
    const client = clientWithCached([{ status_code: 201, response: { data: { id: 'abc' } } }]);
    mockPool.connect.mockResolvedValueOnce(client);
    const req = { headers: { 'x-idempotency-key': 'idem-key-1' }, user: { org_id: 'org-1' } };
    const res = responseWithEvents();
    const next = jest.fn();

    requireIdempotencyKey(req, res, next);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(client.query.mock.calls[0][0]).toContain('pg_advisory_lock');
    expect(client.query.mock.calls[1][0]).toContain('SELECT status_code, response FROM idempotency_keys');
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ data: { id: 'abc' } });
    expect(next).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('wraps JSON responses and persists the result before releasing the lock', async () => {
    const client = clientWithCached([]);
    mockPool.connect.mockResolvedValueOnce(client);
    const req = { headers: { 'x-idempotency-key': 'idem-key-2' }, user: { org_id: 'org-1' } };
    const res = responseWithEvents();
    const next = jest.fn();

    requireIdempotencyKey(req, res, next);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(next).toHaveBeenCalledTimes(1);

    res.status(201).json({ data: { created: true } });
    await new Promise(resolve => setTimeout(resolve, 10));
    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO idempotency_keys'));
    expect(insert).toBeDefined();
    expect(insert[1]).toEqual(['idem-key-2', 'org-1', 201, JSON.stringify({ data: { created: true } })]);

    res.emit('finish');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(client.query.mock.calls.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('does not cache 5xx responses and still releases the advisory lock', async () => {
    const client = clientWithCached([]);
    mockPool.connect.mockResolvedValueOnce(client);
    const req = { headers: { 'x-idempotency-key': 'idem-key-5xx' }, user: { org_id: 'org-1' } };
    const res = responseWithEvents();
    const next = jest.fn();

    requireIdempotencyKey(req, res, next);
    await new Promise(resolve => setTimeout(resolve, 10));
    res.status(503).json({ error: 'temporary_failure' });
    res.emit('finish');
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO idempotency_keys'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('fails closed when req.user has no tenant identity', () => {
    const req = { headers: { 'x-idempotency-key': 'idem-key-3' } };
    const res = responseWithEvents();
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'tenant_scope_required' });
    expect(next).not.toHaveBeenCalled();
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects blank or excessively long keys', () => {
    const req = { headers: { 'x-idempotency-key': ' '.repeat(201) }, user: { org_id: 'org-1' } };
    const res = responseWithEvents();
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_idempotency_key' });
    expect(next).not.toHaveBeenCalled();
    expect(mockPool.connect).not.toHaveBeenCalled();
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
