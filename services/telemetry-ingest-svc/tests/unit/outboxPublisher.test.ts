import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pool: { connect: vi.fn() },
  publish: vi.fn(),
  getJs: vi.fn(),
}));

vi.mock('../../src/db.js', () => ({ pool: mocks.pool }));
vi.mock('../../src/nats.js', () => ({ getJs: mocks.getJs }));

import { publishPendingOutboxBatch } from '../../src/lib/outboxPublisher.js';

const row = {
  id: '12',
  subject: 'telemetry.gps.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222',
  payload: { seq_no: 42, lat: -1.2, lng: 36.8 },
  message_id: 'device-a:42:1770000000000000',
  publish_attempts: 0,
};

describe('durable telemetry outbox publisher', () => {
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id, subject, payload, message_id')) return { rows: [row], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    mocks.pool.connect.mockResolvedValue(client);
    mocks.publish.mockResolvedValue({ stream: 'TELEMETRY', seq: 1, duplicate: false });
    mocks.getJs.mockReturnValue({ publish: mocks.publish });
  });

  it('deletes an event only after JetStream acknowledges it', async () => {
    await expect(publishPendingOutboxBatch()).resolves.toEqual({ published: 1, deferred: 0 });
    expect(mocks.publish).toHaveBeenCalledWith(row.subject, expect.any(Uint8Array), { msgID: row.message_id });
    const deleteAt = client.query.mock.calls.findIndex(call => String(call[0]).includes('DELETE FROM telemetry_ingest_outbox'));
    const commitAt = client.query.mock.calls.findIndex(call => String(call[0]) === 'COMMIT');
    expect(deleteAt).toBeGreaterThan(-1);
    expect(commitAt).toBeGreaterThan(deleteAt);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('retains failed events and schedules exponential retry', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('broker unavailable'));
    await expect(publishPendingOutboxBatch()).resolves.toEqual({ published: 0, deferred: 1 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('publish_attempts = publish_attempts + 1'),
      [row.id, 1, 'broker unavailable'],
    );
    expect(client.query.mock.calls.some(call => String(call[0]).includes('DELETE FROM telemetry_ingest_outbox'))).toBe(false);
    expect(client.query.mock.calls.some(call => String(call[0]) === 'COMMIT')).toBe(true);
  });

  it('rolls back and propagates database failures', async () => {
    client.query.mockImplementationOnce(async () => { throw new Error('database unavailable'); });
    await expect(publishPendingOutboxBatch()).rejects.toThrow('database unavailable');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
