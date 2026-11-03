'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-guardian-cfo';
process.env.DATABASE_URL = 'postgresql://localhost/test_placeholder';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  globalQuery: jest.fn(),
}));

jest.mock('../src/utils/cfoFlag', () => ({
  isCfoModuleEnabled: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../src/config/database');
const { isCfoModuleEnabled } = require('../src/utils/cfoFlag');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/guardian/cfo', require('../src/routes/guardianCfo'));
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

const app = buildApp();
const device = {
  id: '11111111-1111-4111-8111-111111111111',
  org_id: '22222222-2222-4222-8222-222222222222',
  status: 'active',
};

describe('Guardian CFO login tenant bootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [] });
    db.globalQuery.mockResolvedValue({ rows: [] });
    isCfoModuleEnabled.mockResolvedValue(true);
  });

  test('uses global bootstrap lookup for a device token before tenant context exists', async () => {
    db.globalQuery.mockResolvedValueOnce({ rows: [device] });

    const response = await request(app)
      .post('/api/v1/guardian/cfo/login')
      .set('X-Device-Token', 'valid-device-token')
      .send({ email: 'cfo@example.com', password: 'not-the-password' });

    expect(db.globalQuery).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT \* FROM guardian_devices WHERE token = \$1 AND deleted_at IS NULL/),
      ['valid-device-token'],
    );
    expect(db.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/SELECT \* FROM guardian_devices WHERE token = \$1/),
      expect.anything(),
    );
    // Once bootstrap succeeds, the flow should reach credential validation:
    // invalid credentials are a 401, not a tenant_scope_required 500.
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
  });

  test('without a recognized device token, login still follows the normal account bootstrap path', async () => {
    const response = await request(app)
      .post('/api/v1/guardian/cfo/login')
      .send({ email: 'cfo@example.com', password: 'not-the-password' });

    expect(response.status).toBe(401);
    expect(db.globalQuery).toHaveBeenCalledWith(
      expect.stringMatching(/FROM users WHERE LOWER\(email\) = \$1 AND role = 'cfo'/),
      ['cfo@example.com'],
    );
  });
});
