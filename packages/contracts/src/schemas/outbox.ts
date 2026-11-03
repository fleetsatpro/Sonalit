import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const OutboxChannelSchema = z.enum([
  'fcm',
  'apns',
  'email',
  'sms',
  'webhook',
  'anthropic',
  'r2_confirm',
  'custom',
]);
export type OutboxChannel = z.infer<typeof OutboxChannelSchema>;

export const OutboxStatusSchema = z.enum([
  'pending',
  'delivered',
  'failed',
  'dead',
]);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

// ---------------------------------------------------------------------------
// OutboxEntry
// Transactional outbox pattern — messages written atomically with business data.
// ---------------------------------------------------------------------------

export const OutboxEntrySchema = z.object({
  id: UuidSchema,
  service: z.string().min(1).max(64).describe('Originating service name'),
  channel: OutboxChannelSchema,
  payload: z
    .record(z.string(), z.string())
    .describe('Channel-specific payload as JSON map'),
  idempotency_key: z.string().max(256).nullable(),
  priority: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1 = highest priority, 5 = lowest'),
  ttl_ms: z.number().int().positive().nullable().describe('Message TTL in milliseconds'),
  attempts: z.number().int().nonnegative(),
  max_attempts: z.number().int().min(1),
  next_attempt_at: IsoDateTimeSchema.nullable(),
  status: OutboxStatusSchema,
  error: z.string().max(2048).nullable(),
  delivered_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
});
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>;

// ---------------------------------------------------------------------------
// Write input — id, attempts, status, delivered_at set by system
// ---------------------------------------------------------------------------

export const CreateOutboxEntryInputSchema = z.object({
  service: z.string().min(1).max(64),
  channel: OutboxChannelSchema,
  payload: z.record(z.string(), z.string()),
  idempotency_key: z.string().max(256).nullable().optional(),
  priority: z.number().int().min(1).max(5).default(3),
  ttl_ms: z.number().int().positive().nullable().optional(),
  max_attempts: z.number().int().min(1).default(5),
});
export type CreateOutboxEntryInput = z.infer<typeof CreateOutboxEntryInputSchema>;
