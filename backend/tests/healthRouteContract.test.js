'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sonalit-health-route-test-secret';
process.env.DATABASE_URL = 'postgresql://localhost/sonalit_health_route_test';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  pool: { end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn(),
  globalQuery: jest.fn(),
  healthCheck: jest.fn(),
}));

jest.mock('../src/config/redis', () => ({
  healthCheck: jest.fn(),
}));

const { healthCheck: databaseHealth, globalQuery } = require('../src/config/database');
const { healthCheck: redisHealth } = require('../src/config/redis');
// app.js performs a guarded startup write through globalQuery when imported.
// Resolve its default mock before requiring the app to keep this test isolated.
databaseHealth.mockResolvedValue(true);
redisHealth.mockResolvedValue('ok');
globalQuery.mockResolvedValue({ rows: [] });
const { app } = require('../src/app');

const healthToken = () => jwt.sign({ id: 'health-test-user' }, process.env.JWT_SECRET, { expiresIn: '5m' });

describe('core health endpoint route contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    databaseHealth.mockResolvedValue(true);
    redisHealth.mockResolvedValue('ok');
    const checkedAt = new Date(Date.now() - 1000).toISOString();
    globalQuery.mockResolvedValue({
      rows: ['gps_logs', 'audit_logs', 'outbox'].map(table_name => ({
        table_name,
        checked_at: checkedAt,
        partitions_ok: true,
      })),
    });
  });

  test('keeps the public platform probe compatible without exposing the component ledger', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      database: 'ok',
      redis: 'ok',
      partitions_ok: true,
      uptime_seconds: expect.any(Number),
      timestamp: expect.any(String),
    });
    expect(response.body).not.toHaveProperty('checks');
    expect(response.body).not.toHaveProperty('coverage');
    expect(response.body).not.toHaveProperty('scope');
    expect(globalQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM partition_health'),
      [['gps_logs', 'audit_logs', 'outbox']],
    );
  });

  test('requires a valid signed token for detailed API diagnostics', async () => {
    const anonymous = await request(app).get('/api/v1/health');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error).toBe('health_auth_required');
    expect(globalQuery).not.toHaveBeenCalled();

    const invalid = await request(app)
      .get('/api/v1/health')
      .set('Authorization', 'Bearer not-a-valid-token');
    expect(invalid.status).toBe(401);
    expect(globalQuery).not.toHaveBeenCalled();
  });

  test('returns the detailed ledger to a valid Sonalit token', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Authorization', `Bearer ${healthToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'api', status: 'healthy' }),
      expect.objectContaining({ id: 'database', status: 'healthy' }),
      expect.objectContaining({ id: 'redis', status: 'healthy' }),
      expect.objectContaining({ id: 'partitions-gps_logs', status: 'healthy' }),
      expect.objectContaining({ id: 'partitions-audit_logs', status: 'healthy' }),
      expect.objectContaining({ id: 'partitions-outbox', status: 'healthy' }),
    ]));
    expect(response.body.coverage.scope).toBe('core-api-dependencies');
  });

  test('keeps an unavailable database non-ready instead of returning an all-clear', async () => {
    databaseHealth.mockResolvedValue(false);

    const response = await request(app)
      .get('/api/v1/health')
      .set('Authorization', `Bearer ${healthToken()}`);

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'database', status: 'unavailable' }),
    ]));
    expect(globalQuery).not.toHaveBeenCalled();
  });
});
