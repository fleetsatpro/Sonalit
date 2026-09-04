// Retrieval (spec §18, §19, §34).
//
// The rule this file exists to enforce is §18: permissions are applied
// BEFORE model context is constructed. Never retrieve broadly and then ask
// the model to ignore what it should not see — unauthorised content must
// not enter the prompt at all. Concretely, every filter below is part of
// the SQL, not a post-filter over results.
//
// Retrieval is hybrid (§34): vector similarity finds semantic matches,
// full-text finds the exact identifiers operators actually type — a
// registration plate, a booking reference — which embeddings match poorly.
// The two candidate sets are fused by reciprocal rank.

import type { PoolClient } from 'pg';
import { embed } from '../ai/router.js';
import {
  AllModelsFailedError,
  NoEligibleModelError,
  type DataClassification,
} from '../ai/types.js';
import { type Role } from '../tools/types.js';
import { KnowledgeUnavailableError, type DocType, type RetrievedChunk } from './types.js';

const ROLE_RANK: Record<Role, number> = {
  admin: 4,
  dispatcher: 3,
  operator: 2,
  analyst: 1,
  cfo: 1,
};

/** Roles whose documents a caller may read: their own rank and below. */
function readableRoles(role: Role): Role[] {
  const rank = ROLE_RANK[role];
  return (Object.keys(ROLE_RANK) as Role[]).filter((r) => ROLE_RANK[r] <= rank);
}

const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  public: 0,
  internal: 1,
  operational: 2,
  sensitive: 3,
  restricted: 4,
};

function readableClassifications(max: DataClassification): DataClassification[] {
  const rank = CLASSIFICATION_RANK[max];
  return (Object.keys(CLASSIFICATION_RANK) as DataClassification[]).filter(
    (c) => CLASSIFICATION_RANK[c] <= rank,
  );
}

export interface RetrieveOptions {
  query: string;
  role: Role;
  /** Highest classification this request may surface. */
  max_classification: DataClassification;
  doc_types?: DocType[];
  limit?: number;
  /**
   * Include documents whose validity window has closed. Default false:
   * §19 requires current state to outrank history unless history is asked
   * for explicitly.
   */
  include_expired?: boolean;
}

interface ChunkRow {
  chunk_id: string;
  document_id: string;
  title: string;
  doc_type: DocType;
  content: string;
  chunk_index: number;
  distance: string | number | null;
  rank: string | number | null;
  uri: string | null;
  source_table: string | null;
  source_id: string | null;
  valid_from: Date | null;
  valid_until: Date | null;
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Retrieves chunks a caller is permitted to see.
 *
 * `client` must already be inside the tenant's RLS context, which handles
 * org isolation; the filters here are the second layer — role,
 * classification and temporal validity.
 */
export async function retrieve(
  options: RetrieveOptions,
  client: PoolClient,
): Promise<RetrievedChunk[]> {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);

  let queryVector: number[];
  let modelName: string;
  try {
    const { result } = await embed({
      capability: 'embedding',
      classification: options.max_classification,
      input: [options.query],
    });
    const vector = result.vectors[0];
    if (!vector) throw new Error('Embedding model returned no vector for the query');
    queryVector = vector;
    // Must match how ingestion keyed the chunks: the embedding space.
    modelName = result.provider_model;
  } catch (err) {
    // §62 — Commander must be able to say retrieval is unavailable rather
    // than answer from the model's own parametric memory.
    if (err instanceof NoEligibleModelError || err instanceof AllModelsFailedError) {
      throw new KnowledgeUnavailableError(err.message);
    }
    throw err;
  }

  const params: unknown[] = [
    toVectorLiteral(queryVector),
    // Comparing vectors across embedding spaces returns noise that looks
    // like a result, so only chunks embedded by THIS model are candidates.
    modelName,
    readableRoles(options.role),
    readableClassifications(options.max_classification),
    options.query,
    limit,
  ];

  let typeFilter = '';
  if (options.doc_types && options.doc_types.length > 0) {
    params.push(options.doc_types);
    typeFilter = `AND d.doc_type = ANY($${String(params.length)})`;
  }

  // Superseded documents are excluded alongside expired ones: a replaced
  // SOP is history, and surfacing it next to its replacement is how a
  // model ends up citing a rescinded procedure as current.
  const temporalFilter = options.include_expired
    ? ''
    : `AND (c.valid_until IS NULL OR c.valid_until > NOW())
       AND (c.valid_from IS NULL OR c.valid_from <= NOW())
       AND d.superseded_by IS NULL`;

  // Reciprocal rank fusion over the two candidate lists. The constant 60 is
  // the standard RRF damping term: it keeps a single list's top hit from
  // dominating when the other list disagrees.
  const sql = `
    WITH permitted AS (
      SELECT c.id, c.document_id, c.content, c.chunk_index, c.embedding,
             c.valid_from, c.valid_until,
             d.title, d.doc_type, d.uri, d.source_table, d.source_id
        FROM ai_document_chunks c
        JOIN ai_documents d ON d.id = c.document_id
       WHERE c.embedding_model = $2
         AND c.required_role = ANY($3)
         AND c.classification = ANY($4)
         ${temporalFilter}
         ${typeFilter}
    ),
    vector_hits AS (
      SELECT id, embedding <=> $1::vector AS distance,
             ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rn
        FROM permitted
       ORDER BY distance
       LIMIT $6 * 4
    ),
    text_hits AS (
      SELECT id,
             ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $5)) AS rank,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $5)) DESC
             ) AS rn
        FROM permitted
       WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', $5)
       LIMIT $6 * 4
    )
    SELECT p.id AS chunk_id, p.document_id, p.title, p.doc_type, p.content,
           p.chunk_index, p.uri, p.source_table, p.source_id,
           p.valid_from, p.valid_until,
           v.distance, t.rank
      FROM permitted p
      LEFT JOIN vector_hits v ON v.id = p.id
      LEFT JOIN text_hits   t ON t.id = p.id
     WHERE v.id IS NOT NULL OR t.id IS NOT NULL
     ORDER BY (COALESCE(1.0 / (60 + v.rn), 0) + COALESCE(1.0 / (60 + t.rn), 0)) DESC
     LIMIT $6
  `;

  const res = await client.query<ChunkRow>(sql, params);
  const now = Date.now();

  return res.rows.map((row) => {
    const distance = row.distance === null ? null : Number(row.distance);
    return {
      chunk_id: row.chunk_id,
      document_id: row.document_id,
      title: row.title,
      doc_type: row.doc_type,
      content: row.content,
      chunk_index: row.chunk_index,
      // Cosine distance is 0 (identical) to 2 (opposite). A chunk found
      // only by keyword has no distance, and gets no invented similarity.
      similarity: distance === null ? 0 : Math.max(0, 1 - distance / 2),
      uri: row.uri,
      source_table: row.source_table,
      source_id: row.source_id,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      stale: row.valid_until !== null && row.valid_until.getTime() <= now,
    };
  });
}
