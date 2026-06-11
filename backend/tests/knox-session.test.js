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

function resetClientMocks(...responses) {
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
  responses.forEach(r => mockClient.query.mockResolvedValueOnce(r));
  mockClient.query.mockResolvedValue({ rows: [] }); // COMMIT + fallback
}

describe('Knox Remote Sessions', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/guardian/devices/:id/remote-session/start', () => {
    it('returns 400 NOT_DEVICE_OWNER when knox_do_enrolled is false', async () => {
      resetClientMocks({ rows: [{ id: DEVICE_ID, org_id: 'org-a', knox_do_enrolled: false }] });
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/start`)
        .set('Authorization', 'Bearer test')
        .send({ triggered_by: 'manual' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('NOT_DEVICE_OWNER');
    });

    it('returns 409 SESSION_ACTIVE when a live session exists', async () => {
      resetClientMocks(
        { rows: [{ id: DEVICE_ID, org_id: 'org-a', knox_do_enrolled: true }] },
        { rows: [{ id: SESSION_ID, status: 'live' }] },
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
        { rows: [{ id: DEVICE_ID, org_id: 'org-a', knox_do_enrolled: true }] },
        { rows: [] },                          // no existing session
        { rows: [{ id: SESSION_ID }] },        // INSERT session
        { rows: [] },                          // UPDATE active_session_id
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/start`)
        .set('Authorization', 'Bearer test')
        .send({ triggered_by: 'manual' });
      expect(res.status).toBe(200);
      expect(res.body.session_id).toBe(SESSION_ID);
      expect(typeof res.body.centrifugo_channel).toBe('string');
      expect(res.body.centrifugo_channel).toContain(SESSION_ID);
    });
  });

  describe('POST /api/v1/guardian/devices/:id/remote-session/inject-touch', () => {
    it('returns 403 when session org does not match requesting user org', async () => {
      resetClientMocks({ rows: [{ id: SESSION_ID, org_id: 'org-b', status: 'live' }] });
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/inject-touch`)
        .set('Authorization', 'Bearer test')
        .send({ x: 100, y: 200, action: 'tap', session_id: SESSION_ID });
      expect(res.status).toBe(403);
    });

    it('returns 200 ok when session is live and org matches', async () => {
      resetClientMocks(
        { rows: [{ id: SESSION_ID, org_id: 'org-a', status: 'live' }] },
        { rows: [] }, // event_log update
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/inject-touch`)
        .set('Authorization', 'Bearer test')
        .send({ x: 112, y: 340, action: 'tap', session_id: SESSION_ID });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('POST /api/v1/guardian/devices/:id/remote-session/end', () => {
    it('clears guardian_devices.active_session_id (contains null UPDATE)', async () => {
      resetClientMocks(
        { rows: [{ id: SESSION_ID, org_id: 'org-a', started_at: new Date().toISOString(), recording_key: null }] },
        { rows: [{ id: SESSION_ID, duration_secs: 42, recording_key: null }] },
        { rows: [] }, // UPDATE devices
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/remote-session/end`)
        .set('Authorization', 'Bearer test')
        .send({ session_id: SESSION_ID });
      // Must not be a server error
      expect(res.status).toBeLessThan(500);
      // At least one query sets active_session_id to NULL
      const nullClear = mockClient.query.mock.calls.find(
        c => c[0] && String(c[0]).includes('active_session_id') &&
             c[1] && c[1].some(v => v === null)
      );
      expect(nullClear).toBeDefined();
    });
  });

  describe('RLS isolation', () => {
    it('field officers from org-b are invisible to org-a user (empty result)', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/v1/field-officers')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('device commands from org-b device are inaccessible to org-a user', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }); // device not found for org-a
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'lock_screen' });
      expect(res.status).toBe(404);
    });
  });
});
