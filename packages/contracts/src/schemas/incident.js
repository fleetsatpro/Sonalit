import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, TimestampsSchema } from './common.js';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const IncidentStatusSchema = z.enum([
    'open',
    'investigating',
    'resolved',
    'closed',
]);
// ---------------------------------------------------------------------------
// Incident
// ---------------------------------------------------------------------------
export const IncidentSchema = TimestampsSchema.extend({
    id: UuidSchema,
    org_id: UuidSchema,
    alert_id: UuidSchema.nullable(),
    title: z.string().min(1).max(256),
    description: z.string().max(4096),
    status: IncidentStatusSchema,
    priority: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe('1 = highest, 5 = lowest priority'),
    assigned_to: UuidSchema.nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    closed_at: IsoDateTimeSchema.nullable(),
});
// ---------------------------------------------------------------------------
// IncidentNote (supports CRDT via Yjs state)
// ---------------------------------------------------------------------------
export const IncidentNoteSchema = z.object({
    id: UuidSchema,
    incident_id: UuidSchema,
    author_id: UuidSchema,
    body: z.string().max(8192),
    yjs_state: z
        .string()
        .base64()
        .nullable()
        .describe('Base64-encoded Yjs document state for CRDT merging'),
    created_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateIncidentInputSchema = z.object({
    org_id: UuidSchema,
    alert_id: UuidSchema.nullable().optional(),
    title: z.string().min(1).max(256),
    description: z.string().max(4096).default(''),
    priority: z.number().int().min(1).max(5).default(3),
    assigned_to: UuidSchema.nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
});
export const UpdateIncidentInputSchema = z.object({
    title: z.string().min(1).max(256).optional(),
    description: z.string().max(4096).optional(),
    status: IncidentStatusSchema.optional(),
    priority: z.number().int().min(1).max(5).optional(),
    assigned_to: UuidSchema.nullable().optional(),
}).refine((obj) => Object.values(obj).some((v) => v !== undefined), { message: 'At least one field must be provided for update' });
export const CreateIncidentNoteInputSchema = z.object({
    incident_id: UuidSchema,
    author_id: UuidSchema,
    body: z.string().min(1).max(8192),
    yjs_state: z.string().base64().nullable().optional(),
});
