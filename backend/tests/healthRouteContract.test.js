'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'sonalit-health-route-test-secret';
process.env.DATABASE_URL = 'postgresql://localhost/sonalit_health_route_test';

const request = require('supertest');

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

  test.each(['/health', '/api/v1/health'])('%s responds through the shared health handler', async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(response.body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'api', status: 'healthy' }),
      expect.objectContaining({ id: 'database', status: 'healthy' }),
      expect.objectContaining({ id: 'redis', status: 'healthy' }),
      expect.objectContaining({ id: 'partitions-gps_logs', status: 'healthy' }),
      expect.objectContaining({ id: 'partitions-audit_logs', status: 'healthy' }),
      expect.objectContaining({ id: 'partitions-outbox', status: 'healthy' }),
    ]));
    expect(globalQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM partition_health'),
      [['gps_logs', 'audit_logs', 'outbox']],
    );
  });

  test('keeps an unavailable database non-ready instead of returning an all-clear', async () => {
    databaseHealth.mockResolvedValue(false);

    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'database', status: 'unavailable' }),
    ]));
    expect(globalQuery).not.toHaveBeenCalled();
  });
});
