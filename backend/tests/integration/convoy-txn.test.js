/**
 * Convoy transaction rollback integration test
 *
 * Verifies that createConvoyCfo rolls back the entire transaction when any
 * step fails — specifically that convoy rows are NOT committed when a mid-
 * transaction validation fails (e.g. CFO user not found).
 *
 * Uses a mock database client to assert BEGIN/ROLLBACK/COMMIT call order
 * without requiring a live database.
 */
'use strict';

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('../../src/config/database', () => ({
  pool: { connect: jest.fn().mockResolvedValue(mockClient) },
  // gAudit calls query(...).catch(...); it must return a thennable so .catch doesn't throw
  query: jest.fn().mockResolvedValue({ rows: [] }),
  healthCheck: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/utils/cfoFlag', () => ({
  isCfoModuleEnabled: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/realtime/centrifugo', () => ({
  publish: jest.fn(),
}));

const { createConvoyCfo } = require('../../src/controllers/convoysCfoController');

const CFO_UUID = '11111111-0000-0000-0000-000000000001';
const VEHICLE_UUID = '22222222-0000-0000-0000-000000000001';

const baseBody = {
  name: 'Test Convoy',
  region: 'Nigeria',
  priority: 'medium',
  route_origin: 'Lagos',
  route_destination: 'Abuja',
  timezone: 'Africa/Lagos',
  start_date: '2026-06-01',
  end_date: '2026-06-03',
  seal_count_per_truck: 2,
  trucks: [
    { position: 1, driver_name: 'Alice Doe', vehicle_id: VEHICLE_UUID },
  ],
  cfos: [
    { cfo_user_id: CFO_UUID, assigned_truck_positions: [1] },
  ],
};

function makeReqRes(body = baseBody) {
  const req = {
    body,
    user: { id: 'admin-user-uuid', role: 'admin', org_id: 'org-001' },
    ip: '127.0.0.1',
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  return { req, res, next: jest.fn() };
}

describe('createConvoyCfo transaction rollback', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rolls back when CFO user is not found, no convoy row committed', async () => {
    // CFO lookup returns no rows → controller calls ROLLBACK
    mockClient.query
      .mockResolvedValueOnce(undefined)               // BEGIN
      .mockResolvedValueOnce({ rows: [] });            // user lookup — CFO not found → triggers ROLLBACK

    // The controller calls ROLLBACK inline before returning 422
    // We intercept after the handler resolves
    const { req, res, next } = makeReqRes();
    await createConvoyCfo(req, res, next);

    const calls = mockClient.query.mock.calls.map(c => c[0]);
    expect(calls[0]).toMatch(/BEGIN/i);
    expect(calls[1]).toContain('SELECT id, role FROM users');
    expect(calls[2]).toMatch(/ROLLBACK/i);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'cfo_user_not_found' })
    );
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('rolls back when CFO user has wrong role', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: CFO_UUID, role: 'driver' }] }) // CFO found but wrong role
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const { req, res, next } = makeReqRes();
    await createConvoyCfo(req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'cfo_user_wrong_role' })
    );

    const calls = mockClient.query.mock.calls.map(c => c[0]);
    expect(calls.some(c => /ROLLBACK/i.test(c))).toBe(true);
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('rolls back and re-throws on unexpected DB error', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('deadlock detected')); // user lookup throws

    const { req, res, next } = makeReqRes();
    await createConvoyCfo(req, res, next);

    const calls = mockClient.query.mock.calls.map(c => c[0]);
    expect(calls.some(c => /ROLLBACK/i.test(c))).toBe(true);
    expect(mockClient.release).toHaveBeenCalled();
    // asyncHandler forwards to next(err)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'deadlock detected' }));
  });

  test('commits on successful creation', async () => {
    const fakeConvoy = { id: 'convoy-uuid-001', name: 'Test Convoy' };
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: CFO_UUID, role: 'cfo' }] }) // user lookup
      .mockResolvedValueOnce({ rows: [fakeConvoy] }) // INSERT convoys
      .mockResolvedValueOnce({ rows: [{ id: 'truck-uuid-001', position: 1 }] }) // INSERT convoy_trucks
      .mockResolvedValueOnce({ rows: [] }) // INSERT convoy_cfos
      .mockResolvedValueOnce({ rows: [] }) // INSERT convoy_cfo_truck_assignments
      .mockResolvedValueOnce(undefined); // COMMIT

    const { req, res } = makeReqRes();
    await createConvoyCfo(req, res, jest.fn());

    const calls = mockClient.query.mock.calls.map(c => c[0]);
    expect(calls[0]).toMatch(/BEGIN/i);
    expect(calls[calls.length - 1]).toMatch(/COMMIT/i);
    expect(calls.some(c => /ROLLBACK/i.test(c))).toBe(false);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockClient.release).toHaveBeenCalled();
  });
});
