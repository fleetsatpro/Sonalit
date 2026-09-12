import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer, getContainerRuntimeClient } from 'testcontainers';

const dockerAvailable = await getContainerRuntimeClient().then(() => true).catch(() => false);
import { connect, type NatsConnection } from 'nats';

// Override config before any module imports
vi.mock('../../src/config.js', () => ({
  config: {
    PORT: 4095,
    NODE_ENV: 'test',
    REDIS_CLUSTER_URL: '',   // will be overridden after container starts
    NATS_URL: '',             // will be overridden after container starts
    LOG_LEVEL: 'error',
    DEDUP_TTL_SECONDS: 60,
    MAX_BATCH_SIZE: 50,
    BATCH_FLUSH_MS: 200,
    BATCH_MAX_ROWS: 1000,
  },
}));

import { config } from '../../src/config.js';

let redisContainer: StartedTestContainer;
let natsContainer: StartedTestContainer;
let natsConn: NatsConnection;

const makeFixes = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    seq_no: offset + i + 1,
    lat: 37.7749 + i * 0.001,
    lng: -122.4194 + i * 0.001,
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
  }));

describe.skipIf(!dockerAvailable)('ingest integration', () => {
  beforeAll(async () => {
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start();

    natsContainer = await new GenericContainer('nats:2.10-alpine')
      .withCommand(['-js'])
      .withExposedPorts(4222)
      .start();

    const redisHost = redisContainer.getHost();
    const redisPort = redisContainer.getMappedPort(6379);
    const natsHost = natsContainer.getHost();
    const natsPort = natsContainer.getMappedPort(4222);

    // Patch config values
    (config as Record<string, unknown>).REDIS_CLUSTER_URL = `redis://${redisHost}:${redisPort}`;
    (config as Record<string, unknown>).NATS_URL = `nats://${natsHost}:${natsPort}`;

    natsConn = await connect({ servers: `nats://${natsHost}:${natsPort}` });
  }, 60_000);

  afterAll(async () => {
    await natsConn?.drain();
    await redisContainer?.stop();
    await natsContainer?.stop();
  });

  it('POST /v4/telemetry/batch with 20 fixes returns 202 with 20 accepted', async () => {
    const { Cluster } = await import('ioredis');
    const { buildServer } = await import('../../src/server.js');
    const { connectNats } = await import('../../src/nats.js');

    await connectNats();

    const app = await buildServer();
    await app.ready();

    const fixes = makeFixes(20);
    const response = await app.inject({
      method: 'POST',
      url: '/v4/telemetry/batch',
      headers: {
        'content-type': 'application/json',
        'x-device-token': 'test-token-device-001',
      },
      payload: {
        device_id: '550e8400-e29b-41d4-a716-446655440000',
        org_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        fixes,
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body) as { accepted: number; duplicate: number };
    expect(body.accepted).toBe(20);
    expect(body.duplicate).toBe(0);

    await app.close();
    const redisClient = new Cluster([{ host: redisContainer.getHost(), port: redisContainer.getMappedPort(6379) }]);
    await redisClient.quit();
  }, 30_000);

  it('same batch again returns 202 with 20 duplicates', async () => {
    const { buildServer } = await import('../../src/server.js');
    const app = await buildServer();
    await app.ready();

    const fixes = makeFixes(20); // same seq_nos as first test

    const response = await app.inject({
      method: 'POST',
      url: '/v4/telemetry/batch',
      headers: {
        'content-type': 'application/json',
        'x-device-token': 'test-token-device-001',
      },
      payload: {
        device_id: '550e8400-e29b-41d4-a716-446655440000',
        org_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        fixes,
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body) as { accepted: number; duplicate: number };
    expect(body.accepted).toBe(0);
    expect(body.duplicate).toBe(20);

    await app.close();
  }, 30_000);

  it('rejects batch exceeding MAX_BATCH_SIZE', async () => {
    const { buildServer } = await import('../../src/server.js');
    const app = await buildServer();
    await app.ready();

    const fixes = makeFixes(51, 1000); // 51 items, exceeds max of 50

    const response = await app.inject({
      method: 'POST',
      url: '/v4/telemetry/batch',
      headers: {
        'content-type': 'application/json',
        'x-device-token': 'test-token-device-002',
      },
      payload: {
        device_id: '550e8400-e29b-41d4-a716-446655440001',
        org_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        fixes,
      },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  }, 30_000);
});
