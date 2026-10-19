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
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // active non-expired key cannot be claimed
      .mockResolvedValueOnce({ rows: [{ status_code: 201, response: { data: { id: 'abc' } }, request_hash: null, expired: false }] });
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
    mockQuery.mockResolvedValueOnce({ rows: [{ key: 'idem-key-2' }] }); // This request owns the claim.
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

  test('fails closed when req.user has no tenant identity', async () => {
    const req = { headers: { 'x-idempotency-key': 'idem-key-3' } };
    const res = { status: jest.fn().mockReturnThis(), statusCode: 200, json: jest.fn() };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'tenant_scope_required' });
    expect(next).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('does not execute a mutation while the same idempotency key is in progress', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status_code: 102, response: { state: 'in_progress' }, request_hash: null, expired: false }] });
    const req = { headers: { 'x-idempotency-key': 'idem-key-active' }, user: { org_id: 'org-1' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'idempotency_in_progress' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('persists the final response before invoking the HTTP response sender', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ key: 'idem-key-save' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const req = { headers: { 'x-idempotency-key': 'idem-key-save' }, user: { org_id: 'org-1' } };
    const originalJson = jest.fn().mockReturnValue('sent');
    const res = { statusCode: 201, json: originalJson };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    expect(next).toHaveBeenCalled();
    const response = res.json({ data: { id: 'new' } });
    expect(originalJson).not.toHaveBeenCalled();
    await response;
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE idempotency_keys'), expect.any(Array));
    expect(originalJson).toHaveBeenCalledWith({ data: { id: 'new' } });
  });

  test('fingerprint is stable to JSON key order but scoped to the authenticated actor and authorization', () => {
    const base = {
      method: 'POST',
      originalUrl: '/api/cds/bookings/b1/containers/c1/clamp',
      body: { lock_serial: 'LOCK-1', driver_name: 'A Driver' },
      user: { id: 'user-a', org_id: 'org-1', role: 'operator' },
    };
    const sameRequest = {
      ...base,
      body: { driver_name: 'A Driver', lock_serial: 'LOCK-1' },
    };
    const anotherActor = { ...base, user: { id: 'user-b', org_id: 'org-1', role: 'operator' } };
    const changedRole = { ...base, user: { id: 'user-a', org_id: 'org-1', role: 'viewer' } };
    expect(requireIdempotencyKey.requestFingerprint(base)).toBe(requireIdempotencyKey.requestFingerprint(sameRequest));
    expect(requireIdempotencyKey.requestFingerprint(base)).not.toBe(requireIdempotencyKey.requestFingerprint(anotherActor));
    expect(requireIdempotencyKey.requestFingerprint(base)).not.toBe(requireIdempotencyKey.requestFingerprint(changedRole));
  });

  test('rejects a key reused for a different request fingerprint', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        status_code: 201,
        response: { data: { id: 'previous' } },
        request_hash: 'f'.repeat(64),
        expired: false,
      }] });
    const req = {
      method: 'POST',
      originalUrl: '/api/cds/bookings/b1/containers/c1/clamp',
      body: { lock_serial: 'LOCK-1' },
      headers: { 'x-idempotency-key': 'idem-key-reuse' },
      user: { org_id: 'org-1' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'idempotency_key_reused_for_different_request',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('turns a 5xx into a permanent unknown-outcome receipt, never a released key', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ key: 'idem-key-unknown' }] })
      .mockResolvedValueOnce({ rows: [{ key: 'idem-key-unknown' }], rowCount: 1 });
    const req = {
      method: 'POST',
      originalUrl: '/api/cds/bookings/b1/containers/c1/unclamp',
      body: { seal_intact: true },
      headers: { 'x-idempotency-key': 'idem-key-unknown' },
      user: { org_id: 'org-1' },
    };
    const originalJson = jest.fn();
    const res = { statusCode: 500, json: originalJson };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    const response = res.json({ error: 'server_failure' });
    expect(originalJson).not.toHaveBeenCalled();
    await response;
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("expires_at = 'infinity'::timestamptz"),
      expect.any(Array),
    );
    expect(mockQuery.mock.calls.some(call => String(call[0]).includes('DELETE FROM idempotency_keys'))).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(originalJson).toHaveBeenCalledWith(expect.objectContaining({ error: 'idempotency_outcome_unknown' }));
  });

  test('an expired pending reservation stays fail-closed instead of being reclaimed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        status_code: 102,
        response: { state: 'in_progress' },
        request_hash: null,
        expired: true,
      }] });
    const req = {
      method: 'POST',
      originalUrl: '/api/cds/bookings/b1/containers/c1/clamp',
      body: { lock_serial: 'LOCK-1' },
      headers: { 'x-idempotency-key': 'idem-key-expired-pending' },
      user: { org_id: 'org-1' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    requireIdempotencyKey(req, res, next);
    await new Promise(r => setTimeout(r, 20));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'idempotency_outcome_unknown' }));
    expect(next).not.toHaveBeenCalled();
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
