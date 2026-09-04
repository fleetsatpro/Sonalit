import { z } from 'zod';
import { DataClassification } from '../ai/types.js';
import { Role } from '../tools/types.js';

/** Dimension of the embedding column. Registered embedding models must match. */
export const EMBEDDING_DIM = 1024;

export const DocType = z.enum([
  'sop',
  'policy',
  'manual',
  'report',
  'incident',
  'procedure',
  'route_doc',
  'other',
]);
export type DocType = z.infer<typeof DocType>;

export const DocumentInput = z.object({
  title: z.string().min(1).max(500),
  doc_type: DocType,
  content: z.string().min(1),
  source_table: z.string().max(100).nullable().default(null),
  source_id: z.string().max(100).nullable().default(null),
  uri: z.string().max(1000).nullable().default(null),
  required_role: Role.default('analyst'),
  classification: DataClassification.default('operational'),
  language: z.string().max(10).default('en'),
  valid_from: z.date().nullable().default(null),
  valid_until: z.date().nullable().default(null),
});
/** Parsed shape, with defaults applied. */
export type DocumentInput = z.infer<typeof DocumentInput>;
/**
 * Shape a caller supplies. Fields carrying defaults are optional here, so
 * ingestion can be called with just a title, type and body.
 */
export type DocumentInputRaw = z.input<typeof DocumentInput>;

export interface RetrievedChunk {
  chunk_id: string;
  document_id: string;
  title: string;
  doc_type: DocType;
  content: string;
  chunk_index: number;
  /** 0-1, higher is closer. Derived from cosine distance, never from a model. */
  similarity: number;
  uri: string | null;
  source_table: string | null;
  source_id: string | null;
  valid_from: Date | null;
  valid_until: Date | null;
  /** True when the chunk's validity window has closed (§19). */
  stale: boolean;
}

/** Raised when RAG cannot run at all, so callers degrade rather than guess. */
export class KnowledgeUnavailableError extends Error {
  constructor(reason: string) {
    super(`Knowledge fabric unavailable: ${reason}`);
    this.name = 'KnowledgeUnavailableError';
  }
}
