import { z } from 'zod';
// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------
export const UlidSchema = z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Must be a valid ULID');
export const UuidSchema = z
    .string()
    .uuid('Must be a valid UUID v4');
export const OrgIdSchema = UuidSchema.brand();
export const Sha256HexSchema = z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'Must be a 64-character hex SHA-256 string');
// ---------------------------------------------------------------------------
// Dates / timestamps
// ---------------------------------------------------------------------------
export const IsoDateTimeSchema = z
    .string()
    .datetime({ offset: true })
    .describe('ISO 8601 datetime with timezone offset');
export const IsoDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
export const TimestampsSchema = z.object({
    created_at: IsoDateTimeSchema,
    updated_at: IsoDateTimeSchema,
});
export const SoftDeleteSchema = TimestampsSchema.extend({
    deleted_at: IsoDateTimeSchema.nullable(),
});
// ---------------------------------------------------------------------------
// Geo
// ---------------------------------------------------------------------------
export const LatLngSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
});
export const GeoJsonPolygonSchema = z.object({
    type: z.literal('Polygon'),
    coordinates: z
        .array(z.array(z.tuple([z.number(), z.number()])))
        .min(1),
});
// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
export const PaginationInputSchema = z.object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).optional(),
});
export const PaginationMetaSchema = z.object({
    total: z.number().int().nonnegative().optional(),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
});
// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
export const DependencyStatusSchema = z.object({
    name: z.string(),
    status: z.enum(['up', 'down', 'degraded']),
    latency_ms: z.number().nonnegative().optional(),
});
export const HealthResponseSchema = z.object({
    status: z.enum(['ok', 'degraded', 'down']),
    version: z.string(),
    uptime_s: z.number().nonnegative(),
    dependencies: z.array(DependencyStatusSchema).optional(),
});
// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------
export const ApiErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.string()).optional(),
    request_id: UuidSchema.optional(),
    trace_id: z.string().optional(),
});
export const ApiErrorEnvelopeSchema = z.object({
    error: ApiErrorSchema,
});
// ---------------------------------------------------------------------------
// Generic success wrapper
// ---------------------------------------------------------------------------
export const OkResponseSchema = z.object({
    ok: z.literal(true),
});
