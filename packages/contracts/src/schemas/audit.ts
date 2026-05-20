import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, Sha256HexSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ActorTypeSchema = z.enum(['user', 'device', 'system']);
export type ActorType = z.infer<typeof ActorTypeSchema>;

// ---------------------------------------------------------------------------
// AuditLog
// Append-only. prev_hash chains entries like a hash-linked list
// to enable tamper-evidence verification.
// ---------------------------------------------------------------------------

export const AuditLogSchema = z.object({
  id: UuidSchema,
  service: z.string().min(1).max(64).describe('Originating service name'),
  action: z
    .string()
    .min(1)
    .max(128)
    .describe('Dot-namespaced action e.g. user.created, convoy.status_changed'),
  actor_type: ActorTypeSchema,
  actor_id: z.string().min(1).max(128).describe('UUID, device ID, or system identifier'),
  org_id: UuidSchema.nullable(),
  resource_type: z.string().min(1).max(64),
  resource_id: z.string().min(1).max(128),
  before_state: z
    .record(z.string(), z.string())
    .nullable()
    .describe('JSON snapshot of state before the action'),
  after_state: z
    .record(z.string(), z.string())
    .nullable()
    .describe('JSON snapshot of state after the action'),
  ip_address: z.string().ip().nullable(),
  user_agent: z.string().max(512).nullable(),
  prev_hash: Sha256HexSchema.describe('SHA-256 of the previous log entry for chain integrity'),
  created_at: IsoDateTimeSchema,
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

// ---------------------------------------------------------------------------
// Write payload — id and prev_hash are added by the audit writer service
// ---------------------------------------------------------------------------

export const AuditLogWriteSchema = AuditLogSchema.omit({
  id: true,
  prev_hash: true,
  created_at: true,
});
export type AuditLogWrite = z.infer<typeof AuditLogWriteSchema>;

// ---------------------------------------------------------------------------
// Query filters
// ---------------------------------------------------------------------------

export const AuditLogQuerySchema = z.object({
  org_id: UuidSchema.optional(),
  actor_id: z.string().optional(),
  resource_type: z.string().optional(),
  resource_id: z.string().optional(),
  action: z.string().optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
