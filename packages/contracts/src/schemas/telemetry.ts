import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const TrackingModeSchema = z.enum([
  'normal',
  'live',
  'stealth',
  'emergency',
]);
export type TrackingMode = z.infer<typeof TrackingModeSchema>;

// ---------------------------------------------------------------------------
// GpsFix
// ---------------------------------------------------------------------------

export const GpsFixSchema = z.object({
  device_id: UuidSchema,
  org_id: UuidSchema,
  seq_no: z
    .number()
    .int()
    .nonnegative()
    .describe('Monotonic sequence number for deduplication; bigint-safe JS number'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  altitude: z.number().nullable(),
  speed: z.number().nonnegative().nullable().describe('Speed in m/s'),
  heading: z.number().min(0).max(360).nullable(),
  accuracy: z.number().nonnegative().nullable().describe('Horizontal accuracy in metres'),
  timestamp: IsoDateTimeSchema,
  tracking_mode: TrackingModeSchema,
});
export type GpsFix = z.infer<typeof GpsFixSchema>;

// ---------------------------------------------------------------------------
// GpsFixBatch
// ---------------------------------------------------------------------------

export const GpsFixBatchSchema = z.object({
  device_id: UuidSchema,
  org_id: UuidSchema,
  fixes: z
    .array(GpsFixSchema)
    .min(1, 'Batch must contain at least 1 fix')
    .max(50, 'Batch must not exceed 50 fixes'),
});
export type GpsFixBatch = z.infer<typeof GpsFixBatchSchema>;

// ---------------------------------------------------------------------------
// Rollup schemas (aggregated time-bucket summaries)
// ---------------------------------------------------------------------------

const RollupBaseSchema = z.object({
  device_id: UuidSchema,
  org_id: UuidSchema,
  bucket: IsoDateTimeSchema.describe('Start of the time bucket'),
  avg_lat: z.number().min(-90).max(90),
  avg_lng: z.number().min(-180).max(180),
  fix_count: z.number().int().nonnegative(),
  max_speed: z.number().nonnegative().nullable(),
  avg_speed: z.number().nonnegative().nullable(),
});

export const GpsRollup1mSchema = RollupBaseSchema.extend({
  resolution: z.literal('1m'),
});
export type GpsRollup1m = z.infer<typeof GpsRollup1mSchema>;

export const GpsRollup5mSchema = RollupBaseSchema.extend({
  resolution: z.literal('5m'),
});
export type GpsRollup5m = z.infer<typeof GpsRollup5mSchema>;

export const GpsRollup1hSchema = RollupBaseSchema.extend({
  resolution: z.literal('1h'),
});
export type GpsRollup1h = z.infer<typeof GpsRollup1hSchema>;

export type GpsRollup = GpsRollup1m | GpsRollup5m | GpsRollup1h;

export const GpsRollupSchema = z.discriminatedUnion('resolution', [
  GpsRollup1mSchema,
  GpsRollup5mSchema,
  GpsRollup1hSchema,
]);
