import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { PoolClient } from 'pg';

// The embedding call goes through the model router; mocking it keeps these
// tests about the SQL that is generated, which is where §18's guarantee
// lives — permissions must be IN the query, not applied to its results.
const { mockEmbed } = vi.hoisted(() => ({ mockEmbed: vi.fn() }));
vi.mock('../ai/router.js', () => ({ embed: mockEmbed }));

const { retrieve } = await import('./retrieve.js');
const { KnowledgeUnavailableError } = await import('./types.js');
const { NoEligibleModelError, AllModelsFailedError } = await import('../ai/types.js');

function fakeClient(): { client: PoolClient; calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [] });
    },
  } as unknown as PoolClient;
  return { client, calls };
}

const baseOptions = {
  query: 'convoy escort procedure',
  role: 'operator' as const,
  max_classification: 'operational' as const,
};

beforeEach(() => {
  mockEmbed.mockReset();
  mockEmbed.mockResolvedValue({
    result: {
      vectors: [[0.1, 0.2, 0.3]],
      model_id: 'row-uuid',
      model_name: 'bge-m3',
      provider_model: 'BAAI/bge-m3',
      model_version: '1',
    },
    attempts: [],
  });
});

describe('retrieve', () => {
  // §18 — the whole point. Unauthorised content must never reach the model
  // context, so the role filter has to be part of the SQL.
  it('filters by role inside the query, not after it', async () => {
    const { client, calls } = fakeClient();
    await retrieve(baseOptions, client);

    const { sql, params } = calls[0] ?? { sql: '', params: [] };
    expect(sql).toContain('c.required_role = ANY($3)');
    // An operator may read operator, analyst and cfo material — not admin
    // or dispatcher.
    expect(params[2]).toEqual(expect.arrayContaining(['operator', 'analyst', 'cfo']));
    expect(params[2]).not.toContain('admin');
    expect(params[2]).not.toContain('dispatcher');
  });

  it('widens the readable set for a higher role', async () => {
    const { client, calls } = fakeClient();
    await retrieve({ ...baseOptions, role: 'admin' }, client);

    expect(calls[0]?.params[2]).toEqual(
      expect.arrayContaining(['admin', 'dispatcher', 'operator', 'analyst', 'cfo']),
    );
  });

  it('filters by classification ceiling inside the query', async () => {
    const { client, calls } = fakeClient();
    await retrieve({ ...baseOptions, max_classification: 'internal' }, client);

    expect(calls[0]?.sql).toContain('c.classification = ANY($4)');
    expect(calls[0]?.params[3]).toEqual(['public', 'internal']);
  });

  // Comparing vectors produced by different models returns noise that looks
  // like a result, so the embedding model is a hard filter.
  it('only considers chunks embedded by the same model', async () => {
    const { client, calls } = fakeClient();
    await retrieve(baseOptions, client);

    expect(calls[0]?.sql).toContain('c.embedding_model = $2');
    // The embedding SPACE, not the registry row UUID: re-registering the
    // same model must not orphan every existing chunk.
    expect(calls[0]?.params[1]).toBe('BAAI/bge-m3');
  });

  // §19 — current state outranks history unless history is asked for.
  it('excludes expired and superseded documents by default', async () => {
    const { client, calls } = fakeClient();
    await retrieve(baseOptions, client);

    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('c.valid_until IS NULL OR c.valid_until > NOW()');
    expect(sql).toContain('d.superseded_by IS NULL');
  });

  it('includes expired documents only when explicitly asked', async () => {
    const { client, calls } = fakeClient();
    await retrieve({ ...baseOptions, include_expired: true }, client);

    const sql = calls[0]?.sql ?? '';
    expect(sql).not.toContain('superseded_by IS NULL');
    expect(sql).not.toContain('valid_until > NOW()');
  });

  it('applies a document-type filter when given', async () => {
    const { client, calls } = fakeClient();
    await retrieve({ ...baseOptions, doc_types: ['sop', 'policy'] }, client);

    expect(calls[0]?.sql).toContain('d.doc_type = ANY($7)');
    expect(calls[0]?.params[6]).toEqual(['sop', 'policy']);
  });

  it('clamps the limit to a sane range', async () => {
    const { client, calls } = fakeClient();
    await retrieve({ ...baseOptions, limit: 5000 }, client);
    expect(calls[0]?.params[5]).toBe(50);

    const second = fakeClient();
    await retrieve({ ...baseOptions, limit: 0 }, second.client);
    expect(second.calls[0]?.params[5]).toBe(1);
  });

  // §62 / Rule 3 — with no embedding model, retrieval reports itself
  // unavailable so Commander can say so, rather than answering unsourced.
  it('reports unavailability instead of querying without an embedding', async () => {
    mockEmbed.mockRejectedValue(new NoEligibleModelError('embedding', 'none registered'));
    const { client, calls } = fakeClient();

    await expect(retrieve(baseOptions, client)).rejects.toBeInstanceOf(KnowledgeUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it('reports unavailability when every embedding model fails', async () => {
    mockEmbed.mockRejectedValue(new AllModelsFailedError('embedding', []));
    const { client } = fakeClient();

    await expect(retrieve(baseOptions, client)).rejects.toBeInstanceOf(KnowledgeUnavailableError);
  });
});

describe('similarity mapping', () => {
  it('does not invent a similarity for a keyword-only hit', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return Promise.resolve({
          rows: [
            {
              chunk_id: 'c1',
              document_id: 'd1',
              title: 'Escort SOP',
              doc_type: 'sop',
              content: 'text',
              chunk_index: 0,
              distance: null, // found by full-text only
              rank: 0.4,
              uri: null,
              source_table: null,
              source_id: null,
              valid_from: null,
              valid_until: null,
            },
          ],
        });
      },
    } as unknown as PoolClient;

    const [hit] = await retrieve(baseOptions, client);

    expect(hit?.similarity).toBe(0);
    expect(hit?.stale).toBe(false);
  });

  it('marks a chunk past its validity window as stale', async () => {
    const client = {
      query: () =>
        Promise.resolve({
          rows: [
            {
              chunk_id: 'c1',
              document_id: 'd1',
              title: 'Old policy',
              doc_type: 'policy',
              content: 'text',
              chunk_index: 0,
              distance: 0.2,
              rank: null,
              uri: null,
              source_table: null,
              source_id: null,
              valid_from: null,
              valid_until: new Date(Date.now() - 86_400_000),
            },
          ],
        }),
    } as unknown as PoolClient;

    const [hit] = await retrieve({ ...baseOptions, include_expired: true }, client);

    expect(hit?.stale).toBe(true);
    expect(hit?.similarity).toBeCloseTo(0.9, 5);
  });
});
