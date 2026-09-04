import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { JetStreamClient } from 'nats';

// withOrgContext does real I/O; capturing it lets these tests assert what
// was written and under which tenant.
const { mockWithOrgContext, writes } = vi.hoisted(() => {
  const writes: { orgId: string; sql: string; params: unknown[] }[] = [];
  return {
    writes,
    mockWithOrgContext: vi.fn(async (orgId: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({
        query: (sql: string, params: unknown[] = []) => {
          writes.push({ orgId, sql, params });
          return Promise.resolve({ rows: [] });
        },
      }),
    ),
  };
});
vi.mock('../db.js', () => ({ withOrgContext: mockWithOrgContext }));

const { WatchtowerConsumer } = await import('./consumer.js');

const ORG = '00000000-0000-4000-8000-00000000000a';
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** A JsMsg stand-in that records ack/nak. */
function message(
  subject: string,
  payload: unknown,
): {
  msg: { subject: string; json: () => unknown; ack: () => void; nak: () => void };
  acked: () => boolean;
  naked: () => boolean;
} {
  let ackCount = 0;
  let nakCount = 0;
  return {
    msg: {
      subject,
      json: () => payload,
      ack: () => {
        ackCount += 1;
      },
      nak: () => {
        nakCount += 1;
      },
    },
    acked: () => ackCount > 0,
    naked: () => nakCount > 0,
  };
}

function consumer(): InstanceType<typeof WatchtowerConsumer> {
  return new WatchtowerConsumer({ js: {} as JetStreamClient, logger });
}

/** Reaches the private handler without starting a live NATS subscription. */
async function feed(
  c: InstanceType<typeof WatchtowerConsumer>,
  m: ReturnType<typeof message>,
): Promise<void> {
  await (c as unknown as { handle: (msg: unknown) => Promise<void> }).handle(m.msg);
}

const now = new Date();
const at = (minutes: number): string => new Date(now.getTime() + minutes * 60_000).toISOString();

beforeEach(() => {
  writes.length = 0;
  mockWithOrgContext.mockClear();
});

describe('WatchtowerConsumer', () => {
  it('persists a normalised signal under its tenant and acks', async () => {
    const c = consumer();
    const m = message(`events.panic.${ORG}`, {
      org_id: ORG,
      device_id: 'd1',
      occurred_at: at(0),
      severity: 'critical',
    });

    await feed(c, m);

    const insert = writes.find((w) => /INSERT INTO ai_signals/.test(w.sql));
    expect(insert?.orgId).toBe(ORG);
    expect(m.acked()).toBe(true);
    expect(m.naked()).toBe(false);
  });

  // A malformed event is not retryable; redelivering it forever would block
  // the consumer, so it is acked and logged rather than left in flight.
  it('acks and logs an event it cannot normalise', async () => {
    const c = consumer();
    const m = message('events.alert.x', { org_id: ORG, type: 'unmapped', vehicle_id: 'v1' });

    await feed(c, m);

    expect(m.acked()).toBe(true);
    expect(writes.some((w) => /INSERT INTO ai_signals/.test(w.sql))).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  // Acking before the write would lose the signal on a crash.
  it('naks rather than acking when the signal cannot be stored', async () => {
    mockWithOrgContext.mockRejectedValueOnce(new Error('db down'));
    const c = consumer();
    const m = message(`events.panic.${ORG}`, { org_id: ORG, device_id: 'd1', occurred_at: at(0) });

    await feed(c, m);

    expect(m.naked()).toBe(true);
    expect(m.acked()).toBe(false);
  });

  // Correlation needs a window, so the first event of a situation must not
  // fire alone — it waits in the buffer for corroboration.
  it('buffers signals and correlates them on flush', async () => {
    const c = consumer();
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'route_deviation',
        convoy_id: 'convoy-17',
        occurred_at: at(0),
      }),
    );
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'idle',
        convoy_id: 'convoy-17',
        occurred_at: at(2),
      }),
    );

    // Nothing correlated yet — only the two raw signals were written.
    expect(writes.some((w) => /INSERT INTO ai_correlations/.test(w.sql))).toBe(false);

    const produced = await c.flush();

    expect(produced).toHaveLength(1);
    expect(produced[0]?.finding).toBe('POSSIBLE OPERATIONAL DISRUPTION');
    expect(writes.some((w) => /INSERT INTO ai_correlations/.test(w.sql))).toBe(true);
  });

  // §30 — a finding must never exist without the signals that justify it.
  it('writes the evidence link for every contributing signal', async () => {
    const c = consumer();
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'route_deviation',
        convoy_id: 'convoy-17',
        occurred_at: at(0),
      }),
    );
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'idle',
        convoy_id: 'convoy-17',
        occurred_at: at(1),
      }),
    );

    const [correlation] = await c.flush();
    const links = writes.filter((w) => /INSERT INTO ai_correlation_signals/.test(w.sql));

    expect(links).toHaveLength(correlation?.signals.length ?? 0);
    for (const link of links) {
      expect(link.params[0]).toBe(correlation?.correlation_id);
    }
  });

  // A situation developing over several minutes must still assemble later.
  it('keeps uncorrelated signals buffered for a later flush', async () => {
    const c = consumer();
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'route_deviation',
        convoy_id: 'convoy-17',
        occurred_at: at(0),
      }),
    );

    expect(await c.flush()).toHaveLength(0);

    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'idle',
        convoy_id: 'convoy-17',
        occurred_at: at(3),
      }),
    );

    expect(await c.flush()).toHaveLength(1);
  });

  it('drops signals older than the correlation window from the buffer', async () => {
    const c = new WatchtowerConsumer({ js: {} as JetStreamClient, logger, windowMs: 60_000 });
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'route_deviation',
        convoy_id: 'c1',
        occurred_at: at(-120),
      }),
    );

    // Evidence is retained in ai_signals; only candidacy for NEW
    // correlations expires.
    expect(await c.flush()).toHaveLength(0);
    expect(writes.some((w) => /INSERT INTO ai_signals/.test(w.sql))).toBe(true);
  });

  it('does not correlate across tenants', async () => {
    const other = '00000000-0000-4000-8000-00000000000b';
    const c = consumer();
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'route_deviation',
        convoy_id: 'shared',
        occurred_at: at(0),
      }),
    );
    await feed(
      c,
      message(`events.alert.${other}`, {
        org_id: other,
        type: 'idle',
        convoy_id: 'shared',
        occurred_at: at(1),
      }),
    );

    expect(await c.flush()).toHaveLength(0);
  });

  it('correlates buffered signals on shutdown rather than discarding them', async () => {
    const c = consumer();
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'route_deviation',
        convoy_id: 'convoy-17',
        occurred_at: at(0),
      }),
    );
    await feed(
      c,
      message(`events.alert.${ORG}`, {
        org_id: ORG,
        type: 'idle',
        convoy_id: 'convoy-17',
        occurred_at: at(1),
      }),
    );

    await c.stop();

    expect(writes.some((w) => /INSERT INTO ai_correlations/.test(w.sql))).toBe(true);
  });
});
