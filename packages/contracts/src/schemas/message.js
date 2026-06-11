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
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateThreadInputSchema = z.object({
    org_id: UuidSchema,
    participants: z.array(UuidSchema).min(2),
    subject: z.string().max(256).nullable().optional(),
});
export const SendMessageInputSchema = z.object({
    thread_id: UuidSchema,
    org_id: UuidSchema,
    author_id: UuidSchema,
    body: z.string().min(1).max(8192),
    attachments: z.array(z.string().url()).max(10).optional().default([]),
});
export const MarkReadInputSchema = z.object({
    message_id: UuidSchema,
    user_id: UuidSchema,
    read_at: IsoDateTimeSchema,
});
