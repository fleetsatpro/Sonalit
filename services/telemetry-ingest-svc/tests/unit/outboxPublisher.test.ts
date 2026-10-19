import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  globalQuery: vi.fn(),
  withOrgContext: vi.fn(),
  publish: vi.fn(),
  getJs: vi.fn(),
  isNatsReady: vi.fn(),
}));

vi.mock('../../src/db.js', () => ({
  globalQuery: mocks.globalQuery,
  withOrgContext: mocks.withOrgContext,
}));
vi.mock('../../src/nats.js', () => ({ getJs: mocks.getJs, isNatsReady: mocks.isNatsReady }));

import { publishPendingOutboxBatch } from '../../src/lib/outboxPublisher.js';

const orgId = '11111111-1111-4111-8111-111111111111';
const row = {
  id: '12',
  org_id: orgId,
  subject: `telemetry.gps.${orgId}.22222222-2222-4222-8222-222222222222`,
  payload: { seq_no: 42, lat: -1.2, lng: 36.8 },
  message_id: 'device-a:42:1770000000000000',
  publish_attempts: 0,
};

describe('durable telemetry outbox publisher', () => {
  let tenantClient: { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    tenantClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id, org_id::text AS org_id, subject')) {
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    mocks.isNatsReady.mockResolvedValue(true);
    mocks.globalQuery.mockResolvedValue([{ id: row.id, org_id: orgId }]);
    mocks.withOrgContext.mockImplementation(async (requestedOrg: string, callback: (client: unknown) => Promise<unknown>) => {
      if (requestedOrg !== orgId) throw new Error('unexpected_tenant');
      return callback(tenantClient);
    });
    mocks.publish.mockResolvedValue({ stream: 'TELEMETRY', seq: 1, duplicate: false });
    mocks.getJs.mockReturnValue({ publish: mocks.publish });
  });

  it('leaves durable rows untouched while NATS is unavailable', async () => {
    mocks.isNatsReady.mockResolvedValue(false);
    await expect(publishPendingOutboxBatch()).resolves.toEqual({ published: 0, deferred: 0 });
    expect(mocks.globalQuery).not.toHaveBeenCalled();
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('discovers only due identities globally, then reads payload under tenant context', async () => {
    await expect(publishPendingOutboxBatch()).resolves.toEqual({ published: 1, deferred: 0 });

    expect(mocks.globalQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, org_id::text AS org_id'),
      [100],
    );
    expect(mocks.withOrgContext).toHaveBeenCalledWith(orgId, expect.any(Function));
    expect(String(tenantClient.query.mock.calls[0]?.[0])).toContain('pg_advisory_xact_lock');
    const scopedSelect = tenantClient.query.mock.calls.find(call => String(call[0]).includes('SELECT id, org_id::text AS org_id, subject'));
    expect(scopedSelect?.[0]).toContain('org_id = $1');
    expect(scopedSelect?.[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(mocks.publish).toHaveBeenCalledWith(row.subject, expect.any(Uint8Array), { msgID: row.message_id });
  });

  it('deletes a row only after JetStream acknowledges the event', async () => {
    await publishPendingOutboxBatch();
    const publishIndex = tenantClient.query.mock.calls.findIndex(call => String(call[0]).includes('SELECT id, org_id::text AS org_id, subject'));
    const deleteIndex = tenantClient.query.mock.calls.findIndex(call => String(call[0]).includes('DELETE FROM telemetry_ingest_outbox'));
    expect(deleteIndex).toBeGreaterThan(publishIndex);
    expect(tenantClient.query.mock.calls[deleteIndex]?.[0]).toContain('org_id = $2');
  });

  it('retains failed events and schedules bounded exponential retry', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('broker unavailable'));
    await expect(publishPendingOutboxBatch()).resolves.toEqual({ published: 0, deferred: 1 });
    expect(tenantClient.query).toHaveBeenCalledWith(
      expect.stringContaining('publish_attempts = publish_attempts + 1'),
      [row.id, orgId, 1, 'broker unavailable'],
    );
    expect(tenantClient.query.mock.calls.some(call => String(call[0]).includes('DELETE FROM telemetry_ingest_outbox'))).toBe(false);
  });

  it('does not enter a tenant transaction when global candidate discovery fails', async () => {
    mocks.globalQuery.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(publishPendingOutboxBatch()).rejects.toThrow('database unavailable');
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('uses deterministic sequential publish order for a selected batch', async () => {
    const second = { ...row, id: '13', message_id: 'device-a:43:1770000001000000', payload: { seq_no: 43 } };
    mocks.globalQuery.mockResolvedValueOnce([
      { id: row.id, org_id: orgId },
      { id: second.id, org_id: orgId },
    ]);
    tenantClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, org_id::text AS org_id, subject')) return { rows: [row, second], rowCount: 2 };
      return { rows: [], rowCount: 1 };
    });

    await publishPendingOutboxBatch();
    expect(mocks.publish.mock.calls.map(call => call[2].msgID)).toEqual([row.message_id, second.message_id]);
  });
});
