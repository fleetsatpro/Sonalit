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
    request.telemetryDevice = { id: mocks.deviceId, org_id: mocks.orgId, status: 'enrolled' };
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

function canonicalMicros(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(value);
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}Z` : value;
}

async function makeServer() {
  const app = Fastify({ logger: false });
  await app.register(ingestRoutes);
  await app.ready();
  return app;
}

describe('telemetry ingest durable acceptance contract', () => {
  let insertedRows: Array<Record<string, unknown>>;
  let conflicts: Array<Record<string, unknown>>;
  let enqueuedRows: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows = [];
    conflicts = [];
    enqueuedRows = [];
    mocks.clientQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO gps_fixes')) {
        const fixes = JSON.parse(String(params[2])) as Array<Record<string, unknown>>;
        insertedRows = fixes.map((fix) => ({
          seq_no: fix.seq_no,
          lat: fix.lat,
          lon: fix.lng,
          alt_m: fix.alt_m ?? null,
          accuracy_m: fix.accuracy_m ?? null,
          speed_kmh: fix.speed_kmh ?? null,
          heading_deg: fix.heading_deg ?? null,
          hdop: fix.hdop ?? null,
          satellites: fix.satellites ?? null,
          timestamp: canonicalMicros(String(fix.timestamp)),
        }));
        return { rows: insertedRows, rowCount: insertedRows.length };
      }
      if (sql.includes('FROM input i') && sql.includes('JOIN gps_fixes stored')) {
        return { rows: conflicts, rowCount: conflicts.length };
      }
      if (sql.includes('INSERT INTO telemetry_ingest_outbox')) {
        const events = JSON.parse(String(params[2])) as Array<Record<string, unknown>>;
        enqueuedRows = events;
        return { rows: events.map((_, i) => ({ id: i + 1 })), rowCount: events.length };
      }
      return { rows: [], rowCount: 0 };
    });
    mocks.withOrgContext.mockImplementation(async (_orgId: string, callback: (client: unknown) => Promise<unknown>) =>
      callback({ query: mocks.clientQuery }));
  });

  it('returns 202 only after raw GPS and publication intent are written in the tenant transaction', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST', url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: { device_id: mocks.deviceId, org_id: mocks.orgId, fixes: [makeFix()] },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ accepted: 1, duplicate: 0, durable: true });
      expect(mocks.withOrgContext).toHaveBeenCalledWith(mocks.orgId, expect.any(Function));
      const calls = mocks.clientQuery.mock.calls.map(call => String(call[0]));
      expect(calls.some(sql => sql.includes('INSERT INTO gps_fixes'))).toBe(true);
      expect(calls.some(sql => sql.includes('JOIN gps_fixes stored'))).toBe(true);
      expect(calls.some(sql => sql.includes('INSERT INTO telemetry_ingest_outbox'))).toBe(true);
      expect(enqueuedRows).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('rejects a tenant mismatch instead of accepting caller-selected scope', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST', url: '/v4/telemetry/batch',
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
        method: 'POST', url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: {
          device_id: mocks.deviceId, org_id: mocks.orgId,
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

  it('counts identical batch duplicates and persists one observation', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST', url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: { device_id: mocks.deviceId, org_id: mocks.orgId, fixes: [makeFix(), makeFix()] },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ accepted: 1, duplicate: 1, durable: true });
      const insertCall = mocks.clientQuery.mock.calls.find(call => String(call[0]).includes('INSERT INTO gps_fixes'));
      expect(JSON.parse(String(insertCall?.[1]?.[2]))).toHaveLength(1);
      expect(enqueuedRows).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('preserves distinct sub-millisecond samples at PostgreSQL microsecond precision', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST', url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: {
          device_id: mocks.deviceId, org_id: mocks.orgId,
          fixes: [
            makeFix({ seq_no: 42, timestamp: '2026-10-19T00:00:00.123456Z' }),
            makeFix({ seq_no: 42, timestamp: '2026-10-19T00:00:00.123457Z', lat: -1.21 }),
          ],
        },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ accepted: 2, duplicate: 0, durable: true });
      const insertCall = mocks.clientQuery.mock.calls.find(call => String(call[0]).includes('INSERT INTO gps_fixes'));
      const serialized = JSON.parse(String(insertCall?.[1]?.[2])) as Array<{ timestamp: string }>;
      expect(serialized.map(fix => fix.timestamp)).toEqual([
        '2026-10-19T00:00:00.123456Z',
        '2026-10-19T00:00:00.123457Z',
      ]);
    } finally {
      await app.close();
    }
  });

  it('persists outbox events in device sequence order regardless of request order', async () => {
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST', url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: {
          device_id: mocks.deviceId,
          org_id: mocks.orgId,
          fixes: [
            makeFix({ seq_no: 43, timestamp: '2026-10-19T00:00:03.000Z', lat: -1.23 }),
            makeFix({ seq_no: 41, timestamp: '2026-10-19T00:00:01.000Z', lat: -1.21 }),
            makeFix({ seq_no: 42, timestamp: '2026-10-19T00:00:02.000Z', lat: -1.22 }),
          ],
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ accepted: 3, duplicate: 0, durable: true });
      expect(enqueuedRows.map((event) => event['seq_no'])).toEqual([41, 42, 43]);

      const outboxInsert = mocks.clientQuery.mock.calls.find(
        (call) => String(call[0]).includes('INSERT INTO telemetry_ingest_outbox'),
      );
      expect(String(outboxInsert?.[0])).toMatch(
        /ORDER BY f\.seq_no,\s*f\.timestamp::timestamptz/i,
      );
    } finally {
      await app.close();
    }
  });

  it('rejects a replay that reuses an existing identity with changed measurements', async () => {
    insertedRows = [];
    conflicts = [{ seq_no: 42 }];
    const app = await makeServer();
    try {
      const response = await app.inject({
        method: 'POST', url: '/v4/telemetry/batch',
        headers: { 'x-device-token': 'test-device-token' },
        payload: { device_id: mocks.deviceId, org_id: mocks.orgId, fixes: [makeFix()] },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'TELEMETRY_IDENTITY_CONFLICT' });
      expect(mocks.clientQuery.mock.calls.some(call => String(call[0]).includes('INSERT INTO telemetry_ingest_outbox'))).toBe(false);
    } finally {
      await app.close();
    }
  });
});
