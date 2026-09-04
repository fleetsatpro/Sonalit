import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

const { mockEmbed } = vi.hoisted(() => ({ mockEmbed: vi.fn() }));
vi.mock('../ai/router.js', () => ({ embed: mockEmbed }));

const { ingestDocument } = await import('./ingest.js');
const { KnowledgeUnavailableError, EMBEDDING_DIM } = await import('./types.js');
const { NoEligibleModelError } = await import('../ai/types.js');

const ORG = '00000000-0000-4000-8000-00000000000a';

function vector(dim = EMBEDDING_DIM): number[] {
  return Array.from({ length: dim }, (_, i) => i / dim);
}

/** Client that answers the pipeline's queries in order and records them. */
function fakeClient(opts: { existing?: { id: string; embedding_model: string } } = {}): {
  client: PoolClient;
  calls: { sql: string; params: unknown[] }[];
} {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM ai_documents d WHERE/.test(sql)) {
        return Promise.resolve({ rows: opts.existing ? [opts.existing] : [] });
      }
      if (/COUNT\(\*\) AS n/.test(sql)) return Promise.resolve({ rows: [{ n: '7' }] });
      if (/INSERT INTO ai_documents/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'doc-1' }] });
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as PoolClient;
  return { client, calls };
}

const input = {
  title: 'Convoy Escort SOP',
  doc_type: 'sop' as const,
  content: 'Escort vehicles travel at the rear.\n\nThe corridor buffer is 300 metres.',
};

beforeEach(() => {
  mockEmbed.mockReset();
  mockEmbed.mockImplementation((req: { input: string[] }) =>
    Promise.resolve({
      result: {
        vectors: req.input.map(() => vector()),
        model_id: 'bge-m3',
        model_version: '1',
      },
      attempts: [],
    }),
  );
});

describe('ingestDocument', () => {
  it('chunks, embeds and indexes a document', async () => {
    const { client, calls } = fakeClient();

    const res = await ingestDocument(input, ORG, client);

    expect(res.deduplicated).toBe(false);
    expect(res.chunks).toBeGreaterThan(0);
    expect(res.embedding_model).toBe('bge-m3');
    expect(calls.some((c) => /INSERT INTO ai_document_chunks/.test(c.sql))).toBe(true);
  });

  // Re-running ingestion over a corpus must not duplicate chunks or re-pay
  // for embeddings, so identical content short-circuits on its checksum.
  it('reuses an already-indexed document without re-embedding', async () => {
    const { client } = fakeClient({ existing: { id: 'doc-existing', embedding_model: 'bge-m3' } });

    const res = await ingestDocument(input, ORG, client);

    expect(res).toEqual({
      document_id: 'doc-existing',
      chunks: 7,
      embedding_model: 'bge-m3',
      deduplicated: true,
    });
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  // A placeholder vector would silently poison every later search, so a
  // missing embedding model means the document is simply not indexed.
  it('does not index anything when no embedding model is available', async () => {
    mockEmbed.mockRejectedValue(new NoEligibleModelError('embedding', 'none registered'));
    const { client, calls } = fakeClient();

    await expect(ingestDocument(input, ORG, client)).rejects.toBeInstanceOf(
      KnowledgeUnavailableError,
    );
    expect(calls.some((c) => /INSERT INTO/.test(c.sql))).toBe(false);
  });

  // Catching this here names the real problem; pgvector's own error does not.
  it('rejects a model whose dimensions do not match the column', async () => {
    mockEmbed.mockResolvedValue({
      result: { vectors: [vector(768)], model_id: 'wrong-dim', model_version: '1' },
      attempts: [],
    });
    const { client, calls } = fakeClient();

    await expect(ingestDocument(input, ORG, client)).rejects.toThrow(/768 dimensions/);
    expect(calls.some((c) => /INSERT INTO/.test(c.sql))).toBe(false);
  });

  it('writes the org id and permission columns onto the document', async () => {
    const { client, calls } = fakeClient();

    await ingestDocument(
      { ...input, required_role: 'dispatcher', classification: 'sensitive' },
      ORG,
      client,
    );

    const insert = calls.find((c) => /INSERT INTO ai_documents/.test(c.sql));
    expect(insert?.params[0]).toBe(ORG);
    expect(insert?.params).toContain('dispatcher');
    expect(insert?.params).toContain('sensitive');
  });

  // Chunks carry a copy of the parent's permissions because retrieval
  // filters on them inside the vector search (§18).
  it('denormalises permissions onto every chunk row', async () => {
    const { client, calls } = fakeClient();

    await ingestDocument({ ...input, required_role: 'admin' }, ORG, client);

    const chunkInsert = calls.find((c) => /INSERT INTO ai_document_chunks/.test(c.sql));
    expect(chunkInsert?.params).toContain('admin');
    expect(chunkInsert?.params).toContain(ORG);
    // Vectors are cast explicitly so pgvector accepts the text literal.
    expect(chunkInsert?.sql).toContain('::vector');
  });

  it('rejects content that yields no chunks', async () => {
    const { client } = fakeClient();
    await expect(ingestDocument({ ...input, content: '   \n\n  ' }, ORG, client)).rejects.toThrow();
  });
});
