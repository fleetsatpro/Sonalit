import { z } from 'zod';

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

export const UlidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Must be a valid ULID');
export type Ulid = z.infer<typeof UlidSchema>;

export const UuidSchema = z
  .string()
  .uuid('Must be a valid UUID v4');
export type Uuid = z.infer<typeof UuidSchema>;

export const OrgIdSchema = UuidSchema.brand<'OrgId'>();
export type OrgId = z.infer<typeof OrgIdSchema>;

export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Must be a 64-character hex SHA-256 string');
export type Sha256Hex = z.infer<typeof Sha256HexSchema>;

// ---------------------------------------------------------------------------
// Dates / timestamps
// ---------------------------------------------------------------------------

export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 datetime with timezone offset');
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
export type IsoDate = z.infer<typeof IsoDateSchema>;

export const TimestampsSchema = z.object({
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type Timestamps = z.infer<typeof TimestampsSchema>;

export const SoftDeleteSchema = TimestampsSchema.extend({
  deleted_at: IsoDateTimeSchema.nullable(),
});
export type SoftDelete = z.infer<typeof SoftDeleteSchema>;

// ---------------------------------------------------------------------------
// Geo
// ---------------------------------------------------------------------------

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const GeoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(z.array(z.tuple([z.number(), z.number()])))
    .min(1),
});
export type GeoJsonPolygon = z.infer<typeof GeoJsonPolygonSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const PaginationInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).optional(),
});
export type PaginationInput = z.infer<typeof PaginationInputSchema>;

export const PaginationMetaSchema = z.object({
  total: z.number().int().nonnegative().optional(),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const DependencyStatusSchema = z.object({
  name: z.string(),
  status: z.enum(['up', 'down', 'degraded']),
  latency_ms: z.number().nonnegative().optional(),
});
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  uptime_s: z.number().nonnegative(),
  dependencies: z.array(DependencyStatusSchema).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

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
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiErrorEnvelopeSchema = z.object({
  error: ApiErrorSchema,
});
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Generic success wrapper
// ---------------------------------------------------------------------------

export const OkResponseSchema = z.object({
  ok: z.literal(true),
});
export type OkResponse = z.infer<typeof OkResponseSchema>;
