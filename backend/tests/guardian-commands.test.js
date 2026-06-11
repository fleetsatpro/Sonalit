'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-cmds';
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

const request = require('supertest');
const { app } = require('../src/app');
const db = require('../src/config/database');

const DEVICE_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CMD_ID    = 'cccccccc-0000-0000-0000-000000000001';
const mockDevice = { id: DEVICE_ID, org_id: 'org-a', status: 'active', knox_do_enrolled: false, deleted_at: null };

describe('Guardian Commands', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/guardian/devices/:id/commands', () => {
    it('rejects remote_wipe without confirm:true → 400 WIPE_REQUIRES_CONFIRM', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockDevice] });
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'remote_wipe' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('WIPE_REQUIRES_CONFIRM');
    });

    it('accepts remote_wipe with confirm:true → 200', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockDevice] })
        .mockResolvedValueOnce({ rows: [{ id: CMD_ID }] });
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'remote_wipe', confirm: true });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('queued');
    });

    it('queues a valid command and returns command_id', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockDevice] })
        .mockResolvedValueOnce({ rows: [{ id: CMD_ID }] });
      const res = await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'lock_screen' });
      expect(res.status).toBe(200);
      expect(res.body.command_id).toBeDefined();
      expect(res.body.status).toBe('queued');
    });

    it('defaults TTL to 6 hours when ttl_hours is absent', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockDevice] })
        .mockResolvedValueOnce({ rows: [{ id: CMD_ID }] });
      await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'request_location' });
      const insertCall = db.query.mock.calls.find(
        c => c[0] && String(c[0]).includes('INSERT INTO device_commands')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1]).toContain(6);
    });

    it('caps TTL at 24 hours when ttl_hours > 24', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [mockDevice] })
        .mockResolvedValueOnce({ rows: [{ id: CMD_ID }] });
      await request(app)
        .post(`/api/v1/guardian/devices/${DEVICE_ID}/commands`)
        .set('Authorization', 'Bearer test')
        .send({ command: 'request_location', ttl_hours: 48 });
      const insertCall = db.query.mock.calls.find(
        c => c[0] && String(c[0]).includes('INSERT INTO device_commands')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1]).toContain(24);
      expect(insertCall[1]).not.toContain(48);
    });
  });

  describe('POST /api/v1/guardian/commands/broadcast', () => {
    it('forbids remote_wipe broadcast → 400 BROADCAST_WIPE_FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/v1/guardian/commands/broadcast')
        .set('Authorization', 'Bearer test')
        .send({ command: 'remote_wipe', target: 'all_active' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BROADCAST_WIPE_FORBIDDEN');
    });

    it('rejects when >50 active devices → 400 BROADCAST_LIMIT_EXCEEDED', async () => {
      db.query.mockResolvedValueOnce({
        rows: Array.from({ length: 51 }, (_, i) => ({ id: `dev-${i}`, org_id: 'org-a' })),
      });
      const res = await request(app)
        .post('/api/v1/guardian/commands/broadcast')
        .set('Authorization', 'Bearer test')
        .send({ command: 'lock_screen', target: 'all_active' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BROADCAST_LIMIT_EXCEEDED');
    });

    it('queues one command per device and returns count', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 'dev-1', org_id: 'org-a' }, { id: 'dev-2', org_id: 'org-a' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'cmd-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'cmd-2' }] });
      const res = await request(app)
        .post('/api/v1/guardian/commands/broadcast')
        .set('Authorization', 'Bearer test')
        .send({ command: 'request_location', target: 'all_active' });
      expect(res.status).toBe(200);
      expect(res.body.queued_count).toBe(2);
      expect(Array.isArray(res.body.command_ids)).toBe(true);
    });
  });
});
