import { z } from 'zod';
import { UuidSchema, IsoDateSchema, IsoDateTimeSchema } from './common.js';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const PhotoSessionSchema = z.enum(['sod', 'eod']);
export const PhotoTypeSchema = z.enum([
    'front',
    'rear',
    'seal',
    'cab',
    'cargo',
    'other',
]);
// ---------------------------------------------------------------------------
// CfoPhoto
// ---------------------------------------------------------------------------
export const CfoPhotoSchema = z.object({
    id: UuidSchema,
    convoy_id: UuidSchema,
    convoy_truck_id: UuidSchema,
    cfo_user_id: UuidSchema,
    session: PhotoSessionSchema,
    photo_type: PhotoTypeSchema,
    seal_position: z.number().int().min(1).nullable(),
    report_date: IsoDateSchema,
    photo_url: z.string().url(),
    event_uuid: UuidSchema.describe('Idempotency key — tied to exactly one upload'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    notes: z.string().max(1024).nullable(),
    taken_at: IsoDateTimeSchema,
    committed_at: IsoDateTimeSchema.nullable(),
});
// ---------------------------------------------------------------------------
// Photo session summary
// ---------------------------------------------------------------------------
export const PhotoSessionSummarySchema = z.object({
    convoy_truck_id: UuidSchema,
    session: PhotoSessionSchema,
    report_date: IsoDateSchema,
    total_photos: z.number().int().nonnegative(),
    committed_photos: z.number().int().nonnegative(),
    pending_photos: z.number().int().nonnegative(),
});
