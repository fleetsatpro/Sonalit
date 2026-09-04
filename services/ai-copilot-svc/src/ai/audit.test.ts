import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockWithOrgContext, inserts } = vi.hoisted(() => {
  const inserts: { sql: string; params: unknown[] }[] = [];
  return {
    inserts,
    mockWithOrgContext: vi.fn(async (_orgId: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({
        query: (sql: string, params: unknown[] = []) => {
          inserts.push({ sql, params });
          return Promise.resolve({ rows: [] });
        },
      }),
    ),
  };
});
vi.mock('../db.js', () => ({ withOrgContext: mockWithOrgContext }));

const { recordAudit } = await import('./audit.js');

const ORG = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-0000000000bb';

const base = {
  org_id: ORG,
  request_id: '00000000-0000-4000-8000-0000000000cc',
  capability: 'general' as const,
  classification: 'operational' as const,
  outcome: 'success' as const,
};

beforeEach(() => {
  inserts.length = 0;
  mockWithOrgContext.mockClear();
});

describe('recordAudit', () => {
  it('writes a well-formed row', async () => {
    await recordAudit({ ...base, user_id: USER });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.params[0]).toBe(ORG);
    expect(inserts[0]?.params[1]).toBe(USER);
  });

  // §44 — user_id is a UUID column, so Postgres rejects the whole INSERT on
  // a malformed value. Discarding the entire row would lose the model,
  // tools and outcome a security review actually needs.
  it('keeps the row when an identifier is not a UUID, and records the loss', async () => {
    await recordAudit({ ...base, user_id: 'u1' });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.params[1]).toBeNull();
    const error = inserts[0]?.params[16] as string;
    expect(error).toContain("user_id 'u1' was not a UUID");
  });

  it('preserves the original error alongside the note', async () => {
    await recordAudit({
      ...base,
      user_id: 'not-a-uuid',
      outcome: 'error',
      error: 'upstream timeout',
    });

    const error = inserts[0]?.params[16] as string;
    expect(error).toContain('upstream timeout');
    expect(error).toContain('was not a UUID');
  });

  it('coerces a malformed conversation_id without failing', async () => {
    await recordAudit({ ...base, user_id: USER, conversation_id: 'session-7' });

    expect(inserts[0]?.params[2]).toBeNull();
    expect(inserts[0]?.params[16]).toContain('conversation_id');
  });

  // Rule 3 — an audit outage must not take down operational AI.
  it('never propagates a write failure to the caller', async () => {
    mockWithOrgContext.mockRejectedValueOnce(new Error('db down'));

    await expect(recordAudit({ ...base, user_id: USER })).resolves.toBeUndefined();
  });
});
