'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  },
  healthCheck: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/config/queue', () => ({
  createQueues: jest.fn(),
  getQueues: jest.fn().mockReturnValue({
    gpsQueue: null, alertQueue: null, notificationQueue: null,
    convoyReportQueue: null, convoyArchiveQueue: null,
    deviceQueue: null, knoxQueue: null,
  }),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = { id: 'admin-id', role: 'admin', status: 'active', org_id: 'org-a' };
    next();
  }),
  authorize: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../src/realtime/centrifugo', () => ({
  publish: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/fcm', () => ({
  sendCommandPush: jest.fn().mockResolvedValue(undefined),
  sendPanicAck: jest.fn().mockResolvedValue(undefined),
}));

// Bypass CSRF for tests — field-officers POSTs are not in the guardian/ skip list
jest.mock('../src/middleware/csrf', () => (_req, _res, next) => next());

const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');

const OFFICER_ID = 'fo-1';
const CONVOY_ID  = 'conv-1';

function mockClientSequence(...results) {
  const clientQuery = jest.fn();
  results.forEach((r, i) => clientQuery.mockResolvedValueOnce(r));
  clientQuery.mockResolvedValue({ rows: [] });
  db.pool.connect.mockResolvedValueOnce({ query: clientQuery, release: jest.fn() });
  return clientQuery;
}

describe('Field Officers', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── GET /api/v1/field-officers ─────────────────────────────────────────────

  describe('GET /api/v1/field-officers', () => {
    it('returns officers for the authenticated org', async () => {
      const officer = { id: OFFICER_ID, name: 'Test Officer', org_id: 'org-a', status: 'available' };
      db.query.mockResolvedValueOnce({ rows: [officer] });

      const res = await request(app)
        .get('/api/v1/field-officers')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].org_id).toBe('org-a');
    });

    it('filters by status query param (returns matching rows from db)', async () => {
      const officer = { id: OFFICER_ID, name: 'SOS Officer', org_id: 'org-a', status: 'sos' };
      db.query.mockResolvedValueOnce({ rows: [officer] });

      const res = await request(app)
        .get('/api/v1/field-officers?status=sos')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty array when no officers exist for org (RLS isolation)', async () => {
      // When user is org-a and the DB (via RLS or WHERE clause) finds no rows for that org,
      // officer rows belonging to org-b are invisible.
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/v1/field-officers')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      // Verify the org_id was passed as a query parameter
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('field_officers'),
        expect.arrayContaining(['org-a'])
      );
    });
  });

  // ─── POST /:id/assign-convoy ────────────────────────────────────────────────

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
      // Route: BEGIN → SET LOCAL → SELECT convoy WHERE org_id = 'org-a' → returns nothing
      mockClientSequence(
        {},                  // BEGIN
        {},                  // SET LOCAL
        { rows: [] }         // convoy lookup: WHERE org_id = 'org-a' finds nothing (different org owns it)
      );

      const res = await request(app)
        .post(`/api/v1/field-officers/${OFFICER_ID}/assign-convoy`)
        .set('Authorization', 'Bearer test-token')
        .send({ convoy_id: CONVOY_ID });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Convoy not found/);
    });

    it('returns 200 when convoy belongs to same org', async () => {
      const updatedOfficer = { id: OFFICER_ID, org_id: 'org-a', current_convoy_id: CONVOY_ID, status: 'on_mission' };

      mockClientSequence(
        {},                                        // BEGIN
        {},                                        // SET LOCAL
        { rows: [{ id: CONVOY_ID }] },             // convoy found (same org)
        { rows: [updatedOfficer] },                // UPDATE officer
        { rows: [] },                              // INSERT activity event
        {}                                         // COMMIT
      );

      const res = await request(app)
        .post(`/api/v1/field-officers/${OFFICER_ID}/assign-convoy`)
        .set('Authorization', 'Bearer test-token')
        .send({ convoy_id: CONVOY_ID });

      expect(res.status).toBe(200);
      expect(res.body.data.current_convoy_id).toBe(CONVOY_ID);
    });
  });

  // ─── POST /:id/ping-device ──────────────────────────────────────────────────

  describe('POST /api/v1/field-officers/:id/ping-device', () => {
    it('returns 202 when a device is linked to the officer', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: OFFICER_ID, gd_id: 'dev-1', device_token: 'tok-abc' }],
      });

      const res = await request(app)
        .post(`/api/v1/field-officers/${OFFICER_ID}/ping-device`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(202);
      expect(res.body.data.job_id).toBe('queued');
    });

    it('returns 202 and queues a device:ping job when deviceQueue is available', async () => {
      const mockAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
      require('../src/config/queue').getQueues.mockReturnValue({ deviceQueue: { add: mockAdd } });

      db.query.mockResolvedValueOnce({
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

    it('returns 422 NO_DEVICE_LINKED when officer has no device', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: OFFICER_ID, gd_id: null, device_token: null }],
      });

      const res = await request(app)
        .post(`/api/v1/field-officers/${OFFICER_ID}/ping-device`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('NO_DEVICE_LINKED');
    });

    it('returns 404 when officer is not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post(`/api/v1/field-officers/${OFFICER_ID}/ping-device`)
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
    });
  });
});
