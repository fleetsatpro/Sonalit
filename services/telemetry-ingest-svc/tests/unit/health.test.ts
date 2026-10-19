import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  databaseReady: vi.fn(),
  redisReady: vi.fn(),
  natsReady: vi.fn(),
}));

vi.mock('../../src/db.js', () => ({ isDatabaseReady: mocks.databaseReady }));
vi.mock('../../src/redis.js', () => ({ isRedisReady: mocks.redisReady }));
vi.mock('../../src/nats.js', () => ({ isNatsReady: mocks.natsReady }));

import { healthRoutes } from '../../src/routes/health.js';

describe('telemetry ingestion readiness', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.databaseReady.mockResolvedValue(true);
    mocks.redisReady.mockResolvedValue(true);
    mocks.natsReady.mockResolvedValue(true);
    app = Fastify({ logger: false });
    await app.register(healthRoutes);
    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('keeps ingestion ready when NATS is degraded because the PostgreSQL outbox is durable', async () => {
    mocks.natsReady.mockResolvedValue(false);
    const response = await app.inject({ method: 'GET', url: '/healthz/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { database: 'ok', redis: 'ok', nats: 'degraded' },
      telemetry_delivery: 'durably_queued',
    });
  });

  it('does not declare readiness when PostgreSQL persistence is unavailable', async () => {
    mocks.databaseReady.mockResolvedValue(false);
    const response = await app.inject({ method: 'GET', url: '/healthz/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'not_ready',
      checks: { database: 'degraded', redis: 'ok', nats: 'ok' },
    });
  });

  it('does not declare readiness when Redis-backed auth/rate limiting is unavailable', async () => {
    mocks.redisReady.mockResolvedValue(false);
    const response = await app.inject({ method: 'GET', url: '/healthz/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks.redis).toBe('degraded');
  });
});
