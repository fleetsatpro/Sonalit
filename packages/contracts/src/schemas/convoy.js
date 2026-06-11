import { z } from 'zod';
import { UuidSchema, IsoDateSchema, IsoDateTimeSchema, TimestampsSchema, LatLngSchema } from './common.js';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const ConvoyStatusSchema = z.enum([
    'draft',
    'planned',
    'active',
    'completed',
    'cancelled',
]);
export const CfoRoleSchema = z.enum(['primary', 'backup', 'observer']);
// ---------------------------------------------------------------------------
// Convoy
// ---------------------------------------------------------------------------
export const ConvoySchema = TimestampsSchema.extend({
    id: UuidSchema,
    org_id: UuidSchema,
    name: z.string().min(1).max(256),
    status: ConvoyStatusSchema,
    timezone: z.string().min(1).describe('IANA timezone identifier e.g. Africa/Lagos'),
    start_date: IsoDateSchema,
    end_date: IsoDateSchema,
    seal_count_per_truck: z.number().int().min(0),
});
// ---------------------------------------------------------------------------
// ConvoyTruck
// ---------------------------------------------------------------------------
export const ConvoyTruckSchema = z.object({
    id: UuidSchema,
    convoy_id: UuidSchema,
    position: z.number().int().min(1).describe('Ordinal position in convoy lineup'),
    vehicle_id: UuidSchema.nullable(),
    driver_name: z.string().min(1).max(256),
    driver_phone: z
        .string()
        .regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 phone number')
        .nullable(),
});
// ---------------------------------------------------------------------------
// ConvoyCfo
// ---------------------------------------------------------------------------
export const ConvoyCfoSchema = z.object({
    id: UuidSchema,
    convoy_id: UuidSchema,
    cfo_user_id: UuidSchema,
    guardian_device_id: UuidSchema.nullable(),
    role: CfoRoleSchema,
    created_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// ConvoySegment
// ---------------------------------------------------------------------------
export const ConvoySegmentSchema = z.object({
    id: UuidSchema,
    convoy_id: UuidSchema,
    from_location: LatLngSchema,
    to_location: LatLngSchema,
    distance_km: z.number().nonnegative(),
    estimated_duration_mins: z.number().int().nonnegative(),
});
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateConvoyInputSchema = z.object({
    org_id: UuidSchema,
    name: z.string().min(1).max(256),
    timezone: z.string().min(1),
    start_date: IsoDateSchema,
    end_date: IsoDateSchema,
    seal_count_per_truck: z.number().int().min(0).default(0),
});
export const UpdateConvoyInputSchema = z.object({
    name: z.string().min(1).max(256).optional(),
    status: ConvoyStatusSchema.optional(),
    timezone: z.string().min(1).optional(),
    start_date: IsoDateSchema.optional(),
    end_date: IsoDateSchema.optional(),
    seal_count_per_truck: z.number().int().min(0).optional(),
}).refine((obj) => Object.values(obj).some((v) => v !== undefined), { message: 'At least one field must be provided for update' });
