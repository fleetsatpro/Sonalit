'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-cmds';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

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

const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');

const DEVICE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CMD_ID    = 'cccccccc-0000-0000-0000-000000000001';

// Helper: resets mockClient and queues responses.
// guardian-ops routes use pool.connect() with client.query().
// The transaction sequence is: BEGIN → SET LOCAL → <queries> → COMMIT/ROLLBACK
function resetClientMocks(...responses) {
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
  mockClient.query.mockResolvedValueOnce({ rows: [] }); // SET LOCAL
  responses.forEach(r => mockClient.query.mockResolvedValueOnce(r));
  mockClient.query.mockResolvedValue({ rows: [] }); // COMMIT + fallback
}

describe('Guardian Commands', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/guardian/devices/:id/commands', () => {
    it('rejects remote_wipe without confirm:true → 400 WIPE_REQUIRES_CONFIRM', async () => {
      // Wipe check happens before DB queries
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'remote_wipe' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('WIPE_REQUIRES_CONFIRM');
    });

    it('accepts remote_wipe with confirm:true and queues → 200', async () => {
      resetClientMocks(
        { rows: [{ id: DEVICE_ID }] },  // device check
        { rows: [{ id: CMD_ID }] },     // INSERT command
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'remote_wipe', confirm: true });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('queued');
    });

    it('queues a valid command and returns command_id', async () => {
      resetClientMocks(
        { rows: [{ id: DEVICE_ID }] },  // device check
        { rows: [{ id: CMD_ID }] },     // INSERT command
      );
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'lock_screen' });
      expect(res.status).toBe(200);
      expect(res.body.data.command_id).toBe(CMD_ID);
      expect(res.body.data.status).toBe('queued');
    });

    it('defaults TTL to 6 hours when ttl_hours is absent', async () => {
      resetClientMocks(
        { rows: [{ id: DEVICE_ID }] },
        { rows: [{ id: CMD_ID }] },
      );
      await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'request_location' });
      // Find the INSERT into device_commands among client query calls
      const insertCall = mockClient.query.mock.calls.find(
        c => c[0] && String(c[0]).includes('INSERT INTO device_commands')
      );
      expect(insertCall).toBeDefined();
      // effectiveTtl = Math.min(6, 24) = 6
      expect(insertCall[1]).toContain(6);
    });

    it('caps TTL at 24 hours when ttl_hours > 24', async () => {
      resetClientMocks(
        { rows: [{ id: DEVICE_ID }] },
        { rows: [{ id: CMD_ID }] },
      );
      await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'request_location', ttl_hours: 48 });
      const insertCall = mockClient.query.mock.calls.find(
        c => c[0] && String(c[0]).includes('INSERT INTO device_commands')
      );
      expect(insertCall).toBeDefined();
      // effectiveTtl = Math.min(48, 24) = 24
      expect(insertCall[1]).toContain(24);
      expect(insertCall[1]).not.toContain(48);
    });

    it('returns 404 when device is not found', async () => {
      resetClientMocks({ rows: [] }); // device check returns empty
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'lock_screen' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/guardian/commands/broadcast', () => {
    it('forbids remote_wipe broadcast → 400 BROADCAST_WIPE_FORBIDDEN', async () => {
      // Wipe guard is checked before any DB query
      const res = await request(app)
        .post('/api/v1/guardian/commands/broadcast')
        .set('Authorization', 'Bearer test')
        .send({ command: 'remote_wipe', target: 'all_active' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BROADCAST_WIPE_FORBIDDEN');
    });

    it('rejects when >50 active devices → 400 BROADCAST_LIMIT_EXCEEDED', async () => {
      const fiftyOneDevices = Array.from({ length: 51 }, (_, i) => ({ id: `dev-${i}` }));
      resetClientMocks({ rows: fiftyOneDevices }); // devices query
      const res = await request(app)
        .post('/api/v1/guardian/commands/broadcast')
        .set('Authorization', 'Bearer test')
        .send({ command: 'lock_screen', target: 'all_active' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BROADCAST_LIMIT_EXCEEDED');
    });

    it('queues one command per device and returns count', async () => {
      resetClientMocks(
        { rows: [{ id: 'dev-1' }, { id: 'dev-2' }] }, // devices query
        { rows: [{ id: 'cmd-1' }] },                   // INSERT for dev-1
        { rows: [{ id: 'cmd-2' }] },                   // INSERT for dev-2
      );
      const res = await request(app)
        .post('/api/v1/guardian/commands/broadcast')
        .set('Authorization', 'Bearer test')
        .send({ command: 'request_location', target: 'all_active' });
      expect(res.status).toBe(200);
      expect(res.body.data.queued_count).toBe(2);
      expect(Array.isArray(res.body.data.command_ids)).toBe(true);
    });

    it('returns 400 with Invalid command for unrecognised commands', async () => {
      const res = await request(app)
        .post('/api/v1/guardian/commands/broadcast')
        .set('Authorization', 'Bearer test')
        .send({ command: 'invalid_cmd' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid command');
    });
  });
});
