import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const AlertSeveritySchema = z.enum(['info', 'warning', 'critical']);
export const AlertStatusSchema = z.enum(['open', 'acknowledged', 'resolved']);
// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------
export const AlertSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    device_id: UuidSchema.nullable(),
    convoy_id: UuidSchema.nullable(),
    severity: AlertSeveritySchema,
    status: AlertStatusSchema,
    type: z
        .string()
        .min(1)
        .max(64)
        .describe('Machine-readable alert type e.g. geofence.breach, panic.triggered'),
    title: z.string().min(1).max(256),
    body: z.string().max(2048),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    triggered_at: IsoDateTimeSchema,
    acknowledged_at: IsoDateTimeSchema.nullable(),
    resolved_at: IsoDateTimeSchema.nullable(),
    resolved_by: UuidSchema.nullable(),
});
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateAlertInputSchema = z.object({
    org_id: UuidSchema,
    device_id: UuidSchema.nullable().optional(),
    convoy_id: UuidSchema.nullable().optional(),
    severity: AlertSeveritySchema,
    type: z.string().min(1).max(64),
    title: z.string().min(1).max(256),
    body: z.string().max(2048),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
});
export const AcknowledgeAlertInputSchema = z.object({
    acknowledged_by: UuidSchema,
});
export const ResolveAlertInputSchema = z.object({
    resolved_by: UuidSchema,
});
