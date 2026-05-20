import { z } from 'zod';
import { IsoDateTimeSchema, Sha256HexSchema } from './common.js';

// ---------------------------------------------------------------------------
// IdempotencyKey
// Stores request/response pairs keyed on (key, method, path) triplet.
// Entries expire after TTL (typically 24 hours).
// ---------------------------------------------------------------------------

export const IdempotencyKeySchema = z.object({
  key: z
    .string()
    .min(1)
    .max(256)
    .describe('Client-supplied idempotency key value'),
  method: z
    .string()
    .regex(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/)
    .describe('HTTP method'),
  path: z.string().min(1).max(1024).describe('Request path'),
  request_hash: Sha256HexSchema.describe('SHA-256 of canonical request body'),
  response_status: z.number().int().min(100).max(599),
  response_body: z
    .record(z.string(), z.string())
    .describe('Stored response body as JSON map'),
  created_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
});
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

// ---------------------------------------------------------------------------
// Write input (response filled in after first execution)
// ---------------------------------------------------------------------------

export const IdempotencyKeyWriteSchema = IdempotencyKeySchema.pick({
  key: true,
  method: true,
  path: true,
  request_hash: true,
  expires_at: true,
});
export type IdempotencyKeyWrite = z.infer<typeof IdempotencyKeyWriteSchema>;

export const IdempotencyKeyCompleteSchema = IdempotencyKeySchema.pick({
  response_status: true,
  response_body: true,
});
export type IdempotencyKeyComplete = z.infer<typeof IdempotencyKeyCompleteSchema>;
