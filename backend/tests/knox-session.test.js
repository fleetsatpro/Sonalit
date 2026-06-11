'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-knox';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_BUCKET = 'test-bucket';
process.env.R2_ACCESS_KEY_ID = 'test-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

const mockClient = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
};

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  pool: { connect: jest.fn().mockResolvedValue(mockClient) },
  healthCheck: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/config/queue', () => ({
  createQueues: jest.fn(),
  getQueues: jest.fn().mockReturnValue({
    gpsQueue: null, alertQueue: null, notificationQueue: null,
    convoyReportQueue: null, convoyArchiveQueue: null,
    deviceQueue: null,
    knoxQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) },
  }),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = { id: 'operator-id', role: 'admin', status: 'active', org_id: 'org-a' };
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

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/presigned'),
}));

const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');

const DEVICE_ID  = 'dddddddd-0000-0000-0000-000000000001';
const SESSION_ID = 'ssssssss-0000-0000-0000-000000000001';

// Helper: reset mockClient and queue up responses after the implicit BEGIN.
// The route always calls BEGIN first, so responses[0] is for the first real query.
function resetClientMocks(...responses) {
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
  responses.forEach(r => mockClient.query.mockResolvedValueOnce(r));
  mockClient.query.mockResolvedValue({ rows: [] }); // COMMIT + fallback
}

describe('Knox Remote Sessions', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── POST /devices/:id/remote-session/start ─────────────────────────────────

  describe('POST /api/v1/guardian/devices/:id/remote-session/start', () => {
    it('returns 400 NOT_DEVICE_OWNER when knox_do_enrolled is false', async () => {
      resetClientMocks(
        { rows: [] },                                                              // SET LOCAL
        { rows: [{ id: DEVICE_ID, org_id: 'org-a', knox_do_enrolled: false }] }, // device lookup
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/start`)
        .set('Authorization', 'Bearer test')
        .send({ triggered_by: 'manual' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NOT_DEVICE_OWNER');
    });

    it('returns 409 SESSION_ACTIVE when a live session exists', async () => {
      resetClientMocks(
        { rows: [] },                                                              // SET LOCAL
        { rows: [{ id: DEVICE_ID, org_id: 'org-a', knox_do_enrolled: true }] },  // device found + enrolled
        { rows: [{ id: SESSION_ID, status: 'live' }] },                          // existing active session
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/start`)
        .set('Authorization', 'Bearer test')
        .send({ triggered_by: 'manual' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SESSION_ACTIVE');
      expect(res.body.session_id).toBe(SESSION_ID);
    });

    it('returns 200 with session_id and centrifugo_channel on success', async () => {
      resetClientMocks(
        { rows: [] },                                                              // SET LOCAL
        { rows: [{ id: DEVICE_ID, org_id: 'org-a', knox_do_enrolled: true }] },  // device found + enrolled
        { rows: [] },                                                              // no existing session
        { rows: [{ id: SESSION_ID }] },                                           // INSERT session
        { rows: [] },                                                              // UPDATE active_session_id
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/start`)
        .set('Authorization', 'Bearer test')
        .send({ triggered_by: 'manual' });
      expect(res.status).toBe(200);
      expect(res.body.data.session_id).toBe(SESSION_ID);
      expect(typeof res.body.data.centrifugo_channel).toBe('string');
      expect(res.body.data.centrifugo_channel).toContain(SESSION_ID);
    });
  });

  // ─── POST /devices/:id/remote-session/inject-touch ──────────────────────────

  describe('POST /api/v1/guardian/devices/:id/remote-session/inject-touch', () => {
    it('returns 404 when session org does not match requesting user org (RLS enforcement)', async () => {
      // The route queries WHERE id=$1 AND org_id=$2 using the requesting user's org_id (org-a).
      // A session owned by org-b will not be found, resulting in 404 — not 403.
      resetClientMocks(
        { rows: [] },  // SET LOCAL
        { rows: [] },  // session not found (org-b session invisible to org-a query)
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/inject-touch`)
        .set('Authorization', 'Bearer test')
        .send({ x: 100, y: 200, action: 'tap', session_id: SESSION_ID });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });

    it('returns 200 ok when session is live and org matches', async () => {
      resetClientMocks(
        { rows: [] },                                                           // SET LOCAL
        { rows: [{ id: SESSION_ID, status: 'live' }] },                        // session found (same org)
        { rows: [] },                                                           // event_log update
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/inject-touch`)
        .set('Authorization', 'Bearer test')
        .send({ x: 112, y: 340, action: 'tap', session_id: SESSION_ID });
      expect(res.status).toBe(200);
      expect(res.body.data.ok).toBe(true);
    });
  });

  // ─── POST /devices/:id/remote-session/end ────────────────────────────────────

  describe('POST /api/v1/guardian/devices/:id/remote-session/end', () => {
    it('clears guardian_devices.active_session_id (verifies UPDATE with active_session_id = NULL)', async () => {
      resetClientMocks(
        { rows: [] },                                                                               // SET LOCAL
        { rows: [{ id: SESSION_ID, duration_secs: 42, recording_key: null }] },                   // UPDATE session → ended
        { rows: [] },                                                                               // UPDATE guardian_devices active_session_id = NULL
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/end`)
        .set('Authorization', 'Bearer test')
        .send({ session_id: SESSION_ID });

      expect(res.status).toBe(200);
      expect(res.body.data.session_id).toBe(SESSION_ID);

      // Verify that one of the client queries clears active_session_id (SET active_session_id = NULL)
      const nullClearCall = mockClient.query.mock.calls.find(
        args =>
          typeof args[0] === 'string' &&
          args[0].includes('active_session_id') &&
          (args[0].includes('NULL') || (Array.isArray(args[1]) && args[1].some(v => v === null)))
      );
      expect(nullClearCall).toBeDefined();
    });

    it('returns 400 when session_id is missing', async () => {
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/end`)
        .set('Authorization', 'Bearer test')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/session_id/);
    });

    it('returns 404 when session is not found', async () => {
      resetClientMocks(
        { rows: [] },  // SET LOCAL
        { rows: [] },  // UPDATE session → no rows (not found)
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/end`)
        .set('Authorization', 'Bearer test')
        .send({ session_id: 'nonexistent-session' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });
  });
});
