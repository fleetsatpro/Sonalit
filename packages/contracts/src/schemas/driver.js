import { z } from 'zod';
import { UuidSchema, IsoDateSchema, IsoDateTimeSchema, TimestampsSchema, LatLngSchema } from './common.js';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const DriverStatusSchema = z.enum(['active', 'inactive', 'suspended']);
// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
export const DriverSchema = TimestampsSchema.extend({
    id: UuidSchema,
    org_id: UuidSchema,
    name: z.string().min(1).max(256),
    license_number: z.string().min(1).max(64),
    license_expiry: IsoDateSchema,
    phone: z
        .string()
        .regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 phone number')
        .nullable(),
    email: z.string().email().nullable(),
    status: DriverStatusSchema,
});
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateDriverInputSchema = z.object({
    org_id: UuidSchema,
    name: z.string().min(1).max(256),
    license_number: z.string().min(1).max(64),
    license_expiry: IsoDateSchema,
    phone: z
        .string()
        .regex(/^\+[1-9]\d{6,14}$/)
        .nullable()
        .optional(),
    email: z.string().email().nullable().optional(),
    status: DriverStatusSchema.optional().default('active'),
});
export const UpdateDriverInputSchema = z.object({
    name: z.string().min(1).max(256).optional(),
    license_number: z.string().min(1).max(64).optional(),
    license_expiry: IsoDateSchema.optional(),
    phone: z
        .string()
        .regex(/^\+[1-9]\d{6,14}$/)
        .nullable()
        .optional(),
    email: z.string().email().nullable().optional(),
    status: DriverStatusSchema.optional(),
}).refine((obj) => Object.values(obj).some((v) => v !== undefined), { message: 'At least one field must be provided for update' });
// ---------------------------------------------------------------------------
// Driver Behaviour (S2-F3)
// ---------------------------------------------------------------------------
export const BehaviourEventTypeSchema = z.enum([
    'hard_braking', 'harsh_acceleration', 'harsh_cornering',
    'speeding', 'prolonged_idle', 'fatigue_pattern',
]);
export const DriverBehaviourEventSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    driver_id: UuidSchema,
    vehicle_id: UuidSchema,
    event_type: BehaviourEventTypeSchema,
    severity: z.enum(['minor', 'moderate', 'severe']),
    location: LatLngSchema,
    speed_kmh: z.number().nullable(),
    delta_kmh: z.number().nullable(),
    bearing_delta: z.number().nullable(),
    occurred_at: IsoDateTimeSchema,
});
export const DriverScoreBreakdownSchema = z.object({
    overall: z.number().int().min(0).max(100),
    braking: z.number().int().min(0).max(100),
    acceleration: z.number().int().min(0).max(100),
    cornering: z.number().int().min(0).max(100),
    speeding: z.number().int().min(0).max(100),
    fatigue: z.number().int().min(0).max(100),
    events_30d: z.number().int(),
    period_start: IsoDateSchema,
    period_end: IsoDateSchema,
});
