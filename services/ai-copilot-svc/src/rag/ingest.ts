// Document ingestion (spec §17).
//
// INGEST -> PARSE -> CHUNK -> EMBED -> INDEX. Parsing and OCR are not here:
// this takes text that has already been extracted, so PDF and image
// handling belong in a separate pass (§40) feeding this one.
//
// Embeddings come through the model router, so which model produces them is
// a registry decision. The model NAME is stored on every chunk because
// vectors from different models are not comparable — see retrieve.ts.

import { createHash } from 'node:crypto';

import { embed } from '../ai/router.js';
import { NoEligibleModelError, AllModelsFailedError } from '../ai/types.js';

import { chunkText } from './chunker.js';
import {
  DocumentInput,
  EMBEDDING_DIM,
  KnowledgeUnavailableError,
  type DocumentInputRaw,
} from './types.js';

import type { PoolClient } from 'pg';

/** pgvector's text input format. */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export interface IngestResult {
  document_id: string;
  chunks: number;
  embedding_model: string;
  /** True when an identical document was already indexed and was reused. */
  deduplicated: boolean;
}

/**
 * Ingests one document for a tenant.
 *
 * `client` must already be inside the tenant's RLS context — callers get
 * one from withOrgContext. Re-ingesting identical content is a no-op via
 * the (org_id, checksum) key, which makes the pipeline safe to re-run over
 * a corpus without duplicating chunks or re-paying for embeddings.
 */
export async function ingestDocument(
  input: DocumentInputRaw,
  orgId: string,
  client: PoolClient,
): Promise<IngestResult> {
  const doc = DocumentInput.parse(input);
  const checksum = createHash('sha256').update(doc.content).digest('hex');

  const existing = await client.query<{ id: string; embedding_model: string | null }>(
    `SELECT d.id, (SELECT c.embedding_model FROM ai_document_chunks c
                    WHERE c.document_id = d.id LIMIT 1) AS embedding_model
       FROM ai_documents d WHERE d.org_id = $1 AND d.checksum = $2`,
    [orgId, checksum],
  );
  const existingRow = existing.rows[0];
  if (existingRow) {
    const count = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM ai_document_chunks WHERE document_id = $1`,
      [existingRow.id],
    );
    return {
      document_id: existingRow.id,
      chunks: Number(count.rows[0]?.n ?? 0),
      embedding_model: existingRow.embedding_model ?? 'unknown',
      deduplicated: true,
    };
  }

  const chunks = chunkText(doc.content);
  if (chunks.length === 0) {
    throw new Error('Document produced no chunks — content is empty after normalisation');
  }

  let vectors: number[][];
  let modelName: string;
  try {
    const { result } = await embed({
      capability: 'embedding',
      classification: doc.classification,
      input: chunks.map((c) => c.content),
    });
    vectors = result.vectors;
    // The embedding SPACE, not the registry row — see EmbeddingResponse.
    modelName = result.provider_model;
  } catch (err) {
    // Rule 3 / §49: with no embedding model, the document is simply not
    // indexed. It is never stored with a placeholder vector, which would
    // silently poison every later search.
    if (err instanceof NoEligibleModelError || err instanceof AllModelsFailedError) {
      throw new KnowledgeUnavailableError(err.message);
    }
    throw err;
  }

  // A dimension mismatch means the registry points at a model whose output
  // this schema cannot hold. Failing here is far better than the confusing
  // pgvector error, and it names the actual problem.
  const wrongDim = vectors.find((v) => v.length !== EMBEDDING_DIM);
  if (wrongDim) {
    throw new KnowledgeUnavailableError(
      `Embedding model '${modelName}' returned ${String(wrongDim.length)} dimensions, ` +
        `but ai_document_chunks.embedding is VECTOR(${String(EMBEDDING_DIM)}). ` +
        'Register a model matching the column, or migrate the column.',
    );
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ai_documents (
       org_id, title, doc_type, source_table, source_id, uri,
       required_role, classification, language, valid_from, valid_until, checksum
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      orgId,
      doc.title,
      doc.doc_type,
      doc.source_table,
      doc.source_id,
      doc.uri,
      doc.required_role,
      doc.classification,
      doc.language,
      doc.valid_from,
      doc.valid_until,
      checksum,
    ],
  );
  const documentId = inserted.rows[0]?.id;
  if (!documentId) throw new Error('Document insert returned no id');

  // One multi-row INSERT rather than a loop: a long SOP is hundreds of
  // chunks, and per-chunk round trips dominate ingestion time.
  const values: unknown[] = [];
  const tuples: string[] = [];
  chunks.forEach((chunk, i) => {
    const vector = vectors[i];
    if (!vector) throw new Error(`Missing embedding for chunk ${String(i)}`);
    const base = values.length;
    values.push(
      documentId,
      orgId,
      chunk.index,
      chunk.content,
      chunk.token_estimate,
      toVectorLiteral(vector),
      modelName,
      doc.required_role,
      doc.classification,
      doc.valid_from,
      doc.valid_until,
    );
    const p = (n: number): string => `$${String(base + n)}`;
    tuples.push(
      `(${p(1)},${p(2)},${p(3)},${p(4)},${p(5)},${p(6)}::vector,${p(7)},${p(8)},${p(9)},${p(10)},${p(11)})`,
    );
  });

  await client.query(
    `INSERT INTO ai_document_chunks (
       document_id, org_id, chunk_index, content, token_estimate,
       embedding, embedding_model, required_role, classification,
       valid_from, valid_until
     ) VALUES ${tuples.join(',')}`,
    values,
  );

  return {
    document_id: documentId,
    chunks: chunks.length,
    embedding_model: modelName,
    deduplicated: false,
  };
}
