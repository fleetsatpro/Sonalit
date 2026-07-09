'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-cfo';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

// Self-contained mock factories — hoisted before any require() calls.
jest.mock('../src/config/database', () => {
  const cQ = jest.fn().mockResolvedValue({ rows: [] });
  const cR = jest.fn();
  return {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    pool: { connect: jest.fn().mockResolvedValue({ query: cQ, release: cR }) },
    healthCheck: jest.fn().mockResolvedValue(true),
    _cQ: cQ,
    _cR: cR,
  };
});

jest.mock('../src/utils/cfoFlag', () => ({
  isCfoModuleEnabled: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/config/queue', () => ({
  createQueues: jest.fn(),
  getQueues: jest.fn().mockReturnValue({ convoyReportQueue: null, convoyArchiveQueue: null }),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = { id: 'admin-id', email: 'admin@test.com', role: 'admin', status: 'active' };
    next();
  }),
  authorize: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../src/middleware/audit', () => ({
  auditLog: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../src/config/database');
const { isCfoModuleEnabled } = require('../src/utils/cfoFlag');
const { errorHandler } = require('../src/middleware/error');

const mockQuery = db.query;
const mockCQ = db._cQ;
const mockCR = db._cR;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.set('io', { emit: jest.fn() });
  app.use('/api/v1/convoys', require('../src/routes/convoys'));
  app.use(errorHandler);
  return app;
}

const app = buildApp();

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CID   = '11111111-1111-1111-1111-111111111111';
const VID1  = '22222222-2222-2222-2222-222222222221';
const VID2  = '22222222-2222-2222-2222-222222222222';
const CFOID = '33333333-3333-3333-3333-333333333333';
const CFOID2 = '33333333-3333-3333-3333-333333333334';

const baseConvoy = {
  name: 'Test CFO Convoy', region: 'Kenya', priority: 'medium',
  route_origin: 'Nairobi', route_destination: 'Mombasa',
  start_date: '2026-06-01', end_date: '2026-06-07',
};

const validBody = {
  ...baseConvoy,
  trucks: [
    { vehicle_id: VID1, driver_name: 'Alice Driver', position: 1 },
    { vehicle_id: VID2, driver_name: 'Bob Driver',   position: 2 },
  ],
  cfos: [{ cfo_user_id: CFOID, assigned_truck_positions: [1, 2] }],
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
  mockCQ.mockReset().mockResolvedValue({ rows: [] });
  mockCR.mockReset();
  db.pool.connect.mockResolvedValue({ query: mockCQ, release: mockCR });
  isCfoModuleEnabled.mockResolvedValue(true);
  // convoyReportQueue must exist: with no queue, regenerateReport falls back
  // to inline PDF generation via the real worker, which this suite doesn't mock.
  require('../src/config/queue').getQueues.mockReturnValue({
    convoyReportQueue: { add: jest.fn().mockResolvedValue({}) }, convoyArchiveQueue: null,
  });
});

// ─── Feature Flag ─────────────────────────────────────────────────────────────

describe('Feature flag', () => {
  test('POST /convoys with trucks/cfos returns 403 when module is disabled', async () => {
    isCfoModuleEnabled.mockResolvedValueOnce(false);
    const res = await request(app).post('/api/v1/convoys').send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cfo_module_disabled');
  });
});

// ─── Coverage Validation ──────────────────────────────────────────────────────

describe('Coverage validation', () => {
  test('422 when a truck position is assigned to no CFO', async () => {
    const body = {
      ...validBody,
      cfos: [{ cfo_user_id: CFOID, assigned_truck_positions: [1] }], // position 2 uncovered
    };
    const res = await request(app).post('/api/v1/convoys').send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('truck_uncovered_by_cfo');
  });

  test('422 when two CFOs are assigned to the same truck position', async () => {
    const body = {
      ...baseConvoy,
      trucks: [{ vehicle_id: VID1, driver_name: 'Alice', position: 1 }],
      cfos: [
        { cfo_user_id: CFOID,  assigned_truck_positions: [1] },
        { cfo_user_id: CFOID2, assigned_truck_positions: [1] },
      ],
    };
    const res = await request(app).post('/api/v1/convoys').send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('truck_covered_by_multiple_cfos');
  });

  test('422 when CFO assigned_truck_positions references a position absent from trucks', async () => {
    const body = {
      ...baseConvoy,
      trucks: [{ vehicle_id: VID1, driver_name: 'Alice', position: 1 }],
      cfos: [{ cfo_user_id: CFOID, assigned_truck_positions: [1, 3] }], // position 3 not defined
    };
    const res = await request(app).post('/api/v1/convoys').send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_position_in_cfo_assignment');
  });

  test('422 when cfos array contains duplicate cfo_user_id', async () => {
    const body = {
      ...baseConvoy,
      trucks: [
        { vehicle_id: VID1, driver_name: 'Alice', position: 1 },
        { vehicle_id: VID2, driver_name: 'Bob',   position: 2 },
      ],
      cfos: [
        { cfo_user_id: CFOID, assigned_truck_positions: [1] },
        { cfo_user_id: CFOID, assigned_truck_positions: [2] }, // same user, different entry
      ],
    };
    const res = await request(app).post('/api/v1/convoys').send(body);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('duplicate_cfo_user_id');
  });
});

// ─── Create CFO Convoy ────────────────────────────────────────────────────────

describe('Create CFO convoy', () => {
  test('201 with valid body and CFO user with correct role', async () => {
    const convoyRow = { id: CID, name: validBody.name, status: 'planned' };
    // Transaction: BEGIN, users check, INSERT convoy, 2× truck, 1× cfo, 2× assignment, COMMIT
    mockCQ
      .mockResolvedValueOnce({})                                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: CFOID, role: 'cfo' }] })    // SELECT users
      .mockResolvedValueOnce({ rows: [convoyRow] })                       // INSERT convoy
      .mockResolvedValueOnce({ rows: [{ id: 'tr1', position: 1 }] })     // INSERT truck 1
      .mockResolvedValueOnce({ rows: [{ id: 'tr2', position: 2 }] })     // INSERT truck 2
      .mockResolvedValueOnce({ rows: [{ id: 'cf1' }] })                  // INSERT convoy_cfos
      .mockResolvedValueOnce({ rows: [{ id: 'as1' }] })                  // INSERT assignment pos 1
      .mockResolvedValueOnce({ rows: [{ id: 'as2' }] })                  // INSERT assignment pos 2
      .mockResolvedValueOnce({});                                          // COMMIT

    const res = await request(app).post('/api/v1/convoys').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(CID);
    expect(mockCR).toHaveBeenCalled();
  });

  test('422 when CFO user exists but has wrong role', async () => {
    mockCQ
      .mockResolvedValueOnce({})                                                  // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: CFOID, role: 'dispatcher' }] })     // SELECT users
      .mockResolvedValueOnce({});                                                 // ROLLBACK

    const res = await request(app).post('/api/v1/convoys').send(validBody);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('cfo_user_wrong_role');
  });

  test('201 when vehicle_id is empty string (coerced to null, not sent as empty UUID)', async () => {
    const convoyRow = { id: CID, name: validBody.name, status: 'planned' };
    mockCQ
      .mockResolvedValueOnce({})                                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: CFOID, role: 'cfo' }] })    // SELECT users
      .mockResolvedValueOnce({ rows: [convoyRow] })                       // INSERT convoy
      .mockResolvedValueOnce({ rows: [{ id: 'tr1', position: 1 }] })     // INSERT truck 1
      .mockResolvedValueOnce({ rows: [{ id: 'tr2', position: 2 }] })     // INSERT truck 2
      .mockResolvedValueOnce({ rows: [{ id: 'cf1' }] })                  // INSERT convoy_cfos
      .mockResolvedValueOnce({ rows: [{ id: 'as1' }] })                  // INSERT assignment pos 1
      .mockResolvedValueOnce({ rows: [{ id: 'as2' }] })                  // INSERT assignment pos 2
      .mockResolvedValueOnce({});                                          // COMMIT

    const body = {
      ...validBody,
      trucks: [
        { vehicle_id: '', driver_name: 'Alice Driver', position: 1 },
        { vehicle_id: VID2, driver_name: 'Bob Driver',  position: 2 },
      ],
    };
    const res = await request(app).post('/api/v1/convoys').send(body);
    expect(res.status).toBe(201);
    // Verify empty string was coerced to null before the DB call
    const truckInsertArgs = mockCQ.mock.calls[3][1]; // 4th query = first truck INSERT
    expect(truckInsertArgs[1]).toBeNull();
  });

  test('422 when cfo_truck_limit trigger fires during convoy creation', async () => {
    const limitErr = new Error('cfo_truck_limit_exceeded: a CFO may cover at most 2 trucks');
    const convoyRow = { id: CID, name: validBody.name, status: 'planned' };
    mockCQ
      .mockResolvedValueOnce({})                                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: CFOID, role: 'cfo' }] })    // SELECT users
      .mockResolvedValueOnce({ rows: [convoyRow] })                       // INSERT convoy
      .mockResolvedValueOnce({ rows: [{ id: 'tr1', position: 1 }] })     // INSERT truck 1
      .mockResolvedValueOnce({ rows: [{ id: 'tr2', position: 2 }] })     // INSERT truck 2
      .mockResolvedValueOnce({ rows: [{ id: 'cf1' }] })                  // INSERT convoy_cfos
      .mockRejectedValueOnce(limitErr)                                    // trigger fires on assignment
      .mockResolvedValueOnce({});                                          // ROLLBACK

    const res = await request(app).post('/api/v1/convoys').send(validBody);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('cfo_truck_limit_exceeded');
  });
});

// ─── Status Transitions ───────────────────────────────────────────────────────

describe('Status transitions', () => {
  test('PATCH /:id/status planned → cancelled returns 200', async () => {
    const row = { id: CID, status: 'planned', name: 'Test' };
    mockQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ ...row, status: 'cancelled' }] });
    const res = await request(app)
      .patch(`/api/v1/convoys/${CID}/status`)
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  test('PATCH /:id/status active → cancelled returns 200', async () => {
    const row = { id: CID, status: 'active', name: 'Test' };
    mockQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ ...row, status: 'cancelled' }] });
    const res = await request(app)
      .patch(`/api/v1/convoys/${CID}/status`)
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  test('PATCH /:id/status completed → active returns 422 (invalid transition)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CID, status: 'completed' }] });
    const res = await request(app)
      .patch(`/api/v1/convoys/${CID}/status`)
      .send({ status: 'active' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Invalid status transition/);
  });
});

// ─── Get Convoy Detail ────────────────────────────────────────────────────────

describe('GET /:id — convoy detail', () => {
  test('returns convoy with trucks, cfos, and cfo_truck_assignments arrays', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CID, name: 'Test', status: 'planned' }] })
      .mockResolvedValueOnce({ rows: [] })                                          // vehicles
      .mockResolvedValueOnce({ rows: [{ id: 'tr1', position: 1 }] })               // trucks
      .mockResolvedValueOnce({ rows: [{ id: 'cf1', cfo_user_id: CFOID }] })        // cfos
      .mockResolvedValueOnce({ rows: [{ id: 'as1', convoy_truck_id: 'tr1' }] });   // assignments

    const res = await request(app).get(`/api/v1/convoys/${CID}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.trucks)).toBe(true);
    expect(res.body.data.trucks).toHaveLength(1);
    expect(Array.isArray(res.body.data.cfos)).toBe(true);
    expect(res.body.data.cfos[0].cfo_user_id).toBe(CFOID);
    expect(Array.isArray(res.body.data.cfo_truck_assignments)).toBe(true);
  });

  test('returns 404 for unknown convoy', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/api/v1/convoys/${CID}`);
    expect(res.status).toBe(404);
  });
});

// ─── Daily Reports ────────────────────────────────────────────────────────────

describe('Daily reports', () => {
  const DATE = '2026-06-01';

  test('GET /:id/reports returns reports array', async () => {
    const rpt = { id: 'rpt1', convoy_id: CID, report_date: DATE, status: 'partial', required_photos: 12, received_photos: 8 };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CID }] })  // convoy lookup
      .mockResolvedValueOnce({ rows: [] })               // trucks (Promise.all)
      .mockResolvedValueOnce({ rows: [] })               // cfos  (Promise.all)
      .mockResolvedValueOnce({ rows: [rpt] })            // reports (Promise.all)
      .mockResolvedValueOnce({ rows: [] });              // photos
    const res = await request(app).get(`/api/v1/convoys/${CID}/reports`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.daily_reports)).toBe(true);
    expect(res.body.data.daily_reports[0].report_date).toBe(DATE);
  });

  test('GET /:id/reports returns 404 for unknown convoy', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/api/v1/convoys/unknown-id/reports`);
    expect(res.status).toBe(404);
  });

  test('POST /:id/reports/:date/regenerate returns 400 for invalid date format', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CID }] });
    const res = await request(app)
      .post(`/api/v1/convoys/${CID}/reports/not-a-date/regenerate`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/);
  });

  test('POST /:id/reports/:date/regenerate returns 404 when no report row exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CID }] })   // convoy check
      .mockResolvedValueOnce({ rows: [] })                // no report row
      .mockResolvedValueOnce({ rows: [{ n: 0 }] });      // cfoCount = 0 → 404
    const res = await request(app)
      .post(`/api/v1/convoys/${CID}/reports/${DATE}/regenerate`);
    expect(res.status).toBe(404);
  });

  test('POST /:id/reports/:date/regenerate queues job and returns 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: CID }] })       // convoy check
      .mockResolvedValueOnce({ rows: [{ id: 'rpt1' }] })    // report found
      .mockResolvedValueOnce({ rows: [] })                   // recountPhotos truck count (empty → early return)
      .mockResolvedValueOnce({ rows: [{ id: 'rpt1' }] });   // UPDATE ... RETURNING id
    // gAudit fire-and-forget consumes default mockResolvedValue({ rows: [] })
    const res = await request(app)
      .post(`/api/v1/convoys/${CID}/reports/${DATE}/regenerate`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Report regeneration queued');
  });
});
