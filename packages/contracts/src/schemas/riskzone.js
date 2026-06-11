import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, GeoJsonPolygonSchema } from './common.js';
import { AlertSeveritySchema } from './alert.js';
// ---------------------------------------------------------------------------
// RiskZone
// ---------------------------------------------------------------------------
export const RiskZoneSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    name: z.string().min(1).max(256),
    description: z.string().max(2048).nullable(),
    severity: AlertSeveritySchema,
    polygon: GeoJsonPolygonSchema,
    active: z.boolean(),
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// RiskScore — computed per convoy segment
// ---------------------------------------------------------------------------
export const RiskScoreSchema = z.object({
    convoy_id: UuidSchema,
    segment_id: UuidSchema,
    score: z
        .number()
        .min(0)
        .max(100)
        .describe('Risk score 0 (no risk) to 100 (extreme risk)'),
    factors: z
        .array(z.string().min(1).max(128))
        .describe('Human-readable contributing risk factors'),
    computed_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateRiskZoneInputSchema = z.object({
    org_id: UuidSchema,
    name: z.string().min(1).max(256),
    description: z.string().max(2048).nullable().optional(),
    severity: AlertSeveritySchema,
    polygon: GeoJsonPolygonSchema,
    active: z.boolean().default(true),
});
export const UpdateRiskZoneInputSchema = z.object({
    name: z.string().min(1).max(256).optional(),
    description: z.string().max(2048).nullable().optional(),
    severity: AlertSeveritySchema.optional(),
    polygon: GeoJsonPolygonSchema.optional(),
    active: z.boolean().optional(),
}).refine((obj) => Object.values(obj).some((v) => v !== undefined), { message: 'At least one field must be provided for update' });
