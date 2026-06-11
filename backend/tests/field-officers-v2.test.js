'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';
process.env.NODE_ENV = 'test';

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

jest.mock('../src/config/queue', () => ({
  createQueues: jest.fn(),
  getQueues: jest.fn().mockReturnValue({
    convoyReportQueue: null,
    convoyArchiveQueue: null,
    deviceQueue: null,
    knoxQueue: null,
  }),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = {
      id: 'admin-id',
      email: 'admin@test.com',
      role: 'admin',
      status: 'active',
      org_id: 'org-a',
    };
    next();
  }),
  authorize: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../src/realtime/centrifugo', () => ({
  publish: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../src/config/database');
const { getQueues } = require('../src/config/queue');
const { errorHandler } = require('../src/middleware/error');

const mockQuery = db.query;
const mockCQ = db._cQ;
const mockCR = db._cR;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/field-officers', require('../src/routes/field-officers'));
  app.use(errorHandler);
  return app;
}

const app = buildApp();

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const OFFICER_ID = 'fo-1';
const CONVOY_ID  = 'conv-1';

// ─── Hooks ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
  mockCQ.mockReset().mockResolvedValue({ rows: [] });
  mockCR.mockReset();
  db.pool.connect.mockResolvedValue({ query: mockCQ, release: mockCR });
  getQueues.mockReturnValue({
    convoyReportQueue: null,
    convoyArchiveQueue: null,
    deviceQueue: null,
    knoxQueue: null,
  });
});

// ─── GET /api/v1/field-officers ────────────────────────────────────────────────

describe('GET /api/v1/field-officers', () => {
  it('returns officers filtered by org', async () => {
    const officer = { id: OFFICER_ID, name: 'Test Officer', org_id: 'org-a', status: 'available' };
    mockQuery.mockResolvedValueOnce({ rows: [officer] });

    const res = await request(app)
      .get('/api/v1/field-officers')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].org_id).toBe('org-a');
  });

  it('returns empty array when no officers exist for org', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/field-officers')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ─── GET /api/v1/field-officers?status=sos ────────────────────────────────────

describe('GET /api/v1/field-officers?status=sos', () => {
  it('returns officers filtered by status query param', async () => {
    const officer = { id: OFFICER_ID, name: 'SOS Officer', org_id: 'org-a', status: 'sos' };
    mockQuery.mockResolvedValueOnce({ rows: [officer] });

    const res = await request(app)
      .get('/api/v1/field-officers?status=sos')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── POST /:id/assign-convoy ───────────────────────────────────────────────────

describe('POST /api/v1/field-officers/:id/assign-convoy', () => {
  it('returns 400 when convoy_id is missing', async () => {
    const res = await request(app)
      .post(`/api/v1/field-officers/${OFFICER_ID}/assign-convoy`)
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 404 when convoy belongs to a different org', async () => {
    // Transaction: BEGIN, SET LOCAL, convoy check returns empty (different org)
    mockCQ
      .mockResolvedValueOnce({})                   // BEGIN
      .mockResolvedValueOnce({})                   // SET LOCAL
      .mockResolvedValueOnce({ rows: [] });         // convoy lookup returns nothing (different org_id)

    const res = await request(app)
      .post(`/api/v1/field-officers/${OFFICER_ID}/assign-convoy`)
      .set('Authorization', 'Bearer test-token')
      .send({ convoy_id: CONVOY_ID });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Convoy not found/);
  });

  it('returns 200 when convoy belongs to same org', async () => {
    const updatedOfficer = {
      id: OFFICER_ID, org_id: 'org-a', current_convoy_id: CONVOY_ID, status: 'on_mission',
    };

    mockCQ
      .mockResolvedValueOnce({})                               // BEGIN
      .mockResolvedValueOnce({})                               // SET LOCAL
      .mockResolvedValueOnce({ rows: [{ id: CONVOY_ID }] })   // convoy found (same org)
      .mockResolvedValueOnce({ rows: [updatedOfficer] })       // UPDATE officer
      .mockResolvedValueOnce({ rows: [] })                     // INSERT activity event
      .mockResolvedValueOnce({});                              // COMMIT

    const res = await request(app)
      .post(`/api/v1/field-officers/${OFFICER_ID}/assign-convoy`)
      .set('Authorization', 'Bearer test-token')
      .send({ convoy_id: CONVOY_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.current_convoy_id).toBe(CONVOY_ID);
  });
});

// ─── POST /:id/ping-device ────────────────────────────────────────────────────

describe('POST /api/v1/field-officers/:id/ping-device', () => {
  it('returns 202 when device is linked to officer', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: OFFICER_ID, gd_id: 'dev-1', device_token: 'tok-abc' }],
    });

    const res = await request(app)
      .post(`/api/v1/field-officers/${OFFICER_ID}/ping-device`)
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(202);
    expect(res.body.data.job_id).toBe('queued');
  });

  it('returns 202 when deviceQueue is available and queues a job', async () => {
    const mockAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
    getQueues.mockReturnValue({ deviceQueue: { add: mockAdd } });

    mockQuery.mockResolvedValueOnce({
      rows: [{ id: OFFICER_ID, gd_id: 'dev-1', device_token: 'tok-abc' }],
    });

    const res = await request(app)
      .post(`/api/v1/field-officers/${OFFICER_ID}/ping-device`)
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(202);
    expect(mockAdd).toHaveBeenCalledWith(
      'device:ping',
      expect.objectContaining({ device_id: 'dev-1', officer_id: OFFICER_ID })
    );
  });

  it('returns 422 when no device is linked to officer', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: OFFICER_ID, gd_id: null, device_token: null }],
    });

    const res = await request(app)
      .post(`/api/v1/field-officers/${OFFICER_ID}/ping-device`)
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('NO_DEVICE_LINKED');
  });

  it('returns 404 when officer is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/v1/field-officers/${OFFICER_ID}/ping-device`)
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(404);
  });
});

// ─── RLS: officers from a different org are not visible ───────────────────────

describe('RLS isolation', () => {
  it('officer with org_id=org-b is not returned when user org_id=org-a', async () => {
    // Simulate RLS: DB returns empty rows because org filter excludes org-b officers
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/field-officers')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    // Confirm the query was called with the user's org_id (org-a)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('field_officers'),
      expect.arrayContaining(['org-a'])
    );
  });
});
