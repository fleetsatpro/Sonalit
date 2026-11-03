import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// MessageThread
// ---------------------------------------------------------------------------

export const MessageThreadSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  participants: z
    .array(UuidSchema)
    .min(2, 'A thread requires at least 2 participants'),
  subject: z.string().max(256).nullable(),
  created_at: IsoDateTimeSchema,
});
export type MessageThread = z.infer<typeof MessageThreadSchema>;

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const MessageSchema = z.object({
  id: UuidSchema,
  thread_id: UuidSchema,
  org_id: UuidSchema,
  author_id: UuidSchema,
  body: z.string().min(1).max(8192),
  attachments: z.array(z.string().url()).max(10),
  sent_at: IsoDateTimeSchema,
  read_by: z.array(UuidSchema),
});
export type Message = z.infer<typeof MessageSchema>;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CreateThreadInputSchema = z.object({
  org_id: UuidSchema,
  participants: z.array(UuidSchema).min(2),
  subject: z.string().max(256).nullable().optional(),
});
export type CreateThreadInput = z.infer<typeof CreateThreadInputSchema>;

export const SendMessageInputSchema = z.object({
  thread_id: UuidSchema,
  org_id: UuidSchema,
  author_id: UuidSchema,
  body: z.string().min(1).max(8192),
  attachments: z.array(z.string().url()).max(10).optional().default([]),
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const MarkReadInputSchema = z.object({
  message_id: UuidSchema,
  user_id: UuidSchema,
  read_at: IsoDateTimeSchema,
});
export type MarkReadInput = z.infer<typeof MarkReadInputSchema>;
