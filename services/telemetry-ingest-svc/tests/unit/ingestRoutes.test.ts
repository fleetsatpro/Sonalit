import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withOrgContext: vi.fn(),
  clientQuery: vi.fn(),
  orgId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
}));

vi.mock('../../src/db.js', () => ({ withOrgContext: mocks.withOrgContext }));
vi.mock('../../src/config.js', () => ({ config: { MAX_BATCH_SIZE: 50 } }));
vi.mock('../../src/middleware/deviceAuth.js', () => ({
  deviceAuth: async (request: any) => {
    request.telemetryDevice = {
      id: mocks.deviceId,
      org_id: mocks.orgId,
      status: 'enrolled',
    };
  },
}));

import { ingestRoutes } from '../../src/routes/ingest.js';

function makeFix(overrides: Record<string, unknown> = {}) {
  return {
    seq_no: 42,
    lat: -1.2,
    lng: 36.8,
    timestamp: '2026-10-19T00:00:00.000Z',
    ...overrides,
  };
}

async function makeServer() {
  const app = Fastify({ logger: false });
  await app.register(ingestRoutes);
  await app.ready();
  return app;
}

describe('telemetry ingest durable acceptance contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientQuery.mockResolvedValue({ rows: [{ accepted: 1 }] });
    mocks.withOrgContext.mockImplementation(async (_orgId: string, callback: (client: any) => Promise<unknown>) =>
      callback({ query: mocks.clientQuery }));
  });

  it('returns 202 only after a transaction includes raw GPS and outbox writes', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: {
          device_id: mocks.deviceId,
          org_id: mocks.orgId,
          fixes: [makeFix()],
        },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ accepted: 1, duplicate: 0, durable: true });
      expect(mocks.withOrgContext).toHaveBeenCalledWith(mocks.orgId, expect.any(Function));
      const [sql, params] = mocks.clientQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO gps_fixes');
      expect(sql).toContain('INSERT INTO telemetry_ingest_outbox');
      expect(sql).toContain('ON CONFLICT (device_id, seq_no, time) DO NOTHING');
      expect(params[0]).toBe(mocks.orgId);
      expect(params[1]).toBe(mocks.deviceId);
    } finally {
      await app.close();
    }
  });

  it('rejects a tenant mismatch instead of accepting caller-selected scope', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: {
          device_id: mocks.deviceId,
          org_id: '33333333-3333-4333-8333-333333333333',
          fixes: [makeFix()],
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'ORG_SCOPE_MISMATCH' });
      expect(mocks.withOrgContext).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects conflicting duplicate identities inside one batch', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: {
          device_id: mocks.deviceId,
          org_id: mocks.orgId,
          fixes: [makeFix(), makeFix({ lng: 37.1 })],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'CONFLICTING_DUPLICATE_FIX' });
      expect(mocks.withOrgContext).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('counts identical duplicates and stores the unique observation once', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: {
          device_id: mocks.deviceId,
          org_id: mocks.orgId,
          fixes: [makeFix(), makeFix()],
        },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ accepted: 1, duplicate: 1, durable: true });
      const [, params] = mocks.clientQuery.mock.calls[0];
      expect(JSON.parse(params[2])).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
