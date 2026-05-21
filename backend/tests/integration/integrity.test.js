/**
 * T1.4 — Device integrity check integration test
 *
 * Verifies requireFreshIntegrity middleware behaviour:
 *  - passes through when verdict is fresh and valid
 *  - returns 412 when verdict is stale
 *  - returns 412 when verdict is not MEETS_DEVICE_INTEGRITY
 *  - returns 412 when no verdict is present
 *  - returns 401 when req.device is absent
 *
 * Does NOT require a live database — the middleware reads only req.device
 * which is populated by deviceAuth upstream. DB writes (REQUEST_INTEGRITY
 * enqueue) are mocked.
 */
'use strict';

jest.mock('../../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { connect: jest.fn(), end: jest.fn() },
  healthCheck: jest.fn().mockResolvedValue(true),
}));

const { requireFreshIntegrity } = require('../../src/middleware/requireFreshIntegrity');

function makeDevice(overrides = {}) {
  return {
    id: 'device-uuid-001',
    last_integrity_verdict: 'MEETS_DEVICE_INTEGRITY',
    last_integrity_verdict_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCtx(device) {
  const req = device !== undefined ? { device } : {};
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('requireFreshIntegrity middleware', () => {
  const MAX_AGE = 60; // minutes

  beforeEach(() => jest.clearAllMocks());

  test('calls next() when verdict is fresh and valid', async () => {
    const { req, res, next } = makeCtx(makeDevice());
    await requireFreshIntegrity(MAX_AGE)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 412 when verdict is older than maxAgeMinutes', async () => {
    const staleTime = new Date(Date.now() - (MAX_AGE + 1) * 60 * 1000).toISOString();
    const { req, res, next } = makeCtx(makeDevice({ last_integrity_verdict_at: staleTime }));
    await requireFreshIntegrity(MAX_AGE)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(412);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'integrity_required' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 412 when verdict is FAILS_BASIC_INTEGRITY', async () => {
    const { req, res, next } = makeCtx(makeDevice({ last_integrity_verdict: 'FAILS_BASIC_INTEGRITY' }));
    await requireFreshIntegrity(MAX_AGE)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(412);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'integrity_required' })
    );
  });

  test('returns 412 when verdict is null', async () => {
    const { req, res, next } = makeCtx(makeDevice({
      last_integrity_verdict: null,
      last_integrity_verdict_at: null,
    }));
    await requireFreshIntegrity(MAX_AGE)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(412);
  });

  test('returns 401 when req.device is absent', async () => {
    const { req, res, next } = makeCtx(undefined);
    await requireFreshIntegrity(MAX_AGE)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('enqueues REQUEST_INTEGRITY command when integrity is stale', async () => {
    const { query } = require('../../src/config/database');
    const staleTime = new Date(Date.now() - (MAX_AGE + 5) * 60 * 1000).toISOString();
    const { req, res } = makeCtx(makeDevice({ last_integrity_verdict_at: staleTime }));
    await requireFreshIntegrity(MAX_AGE)(req, res, jest.fn());
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('REQUEST_INTEGRITY'),
      [makeDevice().id]
    );
  });
});
