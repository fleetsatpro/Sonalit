'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  globalQuery: jest.fn(),
  pool: { connect: jest.fn(), end: jest.fn() },
  healthCheck: jest.fn(),
}));

jest.mock('../src/utils/orgScopedDb', () => ({
  attachOrgDb: jest.fn(),
  withOrg: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn(),
  authorize: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../src/utils/tenantContext', () => ({
  runWithOrgContext: jest.fn((_orgId, fn) => fn()),
}));

const { query: mockQuery, globalQuery: mockGlobalQuery } = require('../src/config/database');
const { runWithOrgContext } = require('../src/utils/tenantContext');
const { requireDevice } = require('../src/middleware/fieldAuth');

describe('Field bootstrap tenant boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolves a paired device through the explicit global bootstrap query', async () => {
    const device = {
      id: '11111111-1111-4111-8111-111111111111',
      org_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      label: 'Gate tablet',
      status: 'active',
    };
    mockGlobalQuery.mockResolvedValueOnce({ rows: [device] });

    const req = {
      headers: {
        'x-field-device': 'device-token',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await requireDevice(req, res, next);

    expect(mockGlobalQuery).toHaveBeenCalledTimes(1);
    expect(mockGlobalQuery.mock.calls[0][0]).toMatch(/FROM field_devices/);
    expect(mockGlobalQuery.mock.calls[0][0]).toMatch(/token_hash/);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(req.fieldDevice).toEqual(device);
    expect(runWithOrgContext).toHaveBeenCalledWith(device.org_id, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('fails closed as unauthorised when no active device matches', async () => {
    mockGlobalQuery.mockResolvedValueOnce({ rows: [] });

    const req = {
      headers: {
        'x-field-device': 'unknown-device-token',
      },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await requireDevice(req, res, next);

    expect(mockGlobalQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'device_not_paired' });
    expect(next).not.toHaveBeenCalled();
  });

  test('pairing route keeps its pre-tenant device lookup on globalQuery', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/routes/field.js'),
      'utf8',
    );
    const pairingStart = source.indexOf("router.post('/app/pair'");
    const pairingEnd = source.indexOf("router.get('/app/device'");
    expect(pairingStart).toBeGreaterThanOrEqual(0);
    expect(pairingEnd).toBeGreaterThan(pairingStart);

    const block = source.slice(pairingStart, pairingEnd);
    expect(block).toContain('await globalQuery(');
    expect(block).not.toContain('await query(');
  });
});
