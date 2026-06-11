import { z } from 'zod';
import { UuidSchema, IsoDateSchema, IsoDateTimeSchema, TimestampsSchema } from './common.js';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const VehicleTypeSchema = z.enum([
    'truck',
    'van',
    'pickup',
    'tanker',
    'flatbed',
    'refrigerated',
    'armoured',
    'other',
]);
export const VehicleStatusSchema = z.enum([
    'active',
    'inactive',
    'maintenance',
    'retired',
]);
// ---------------------------------------------------------------------------
// VehicleDocument
// ---------------------------------------------------------------------------
export const VehicleDocumentTypeSchema = z.enum([
    'insurance',
    'roadworthy',
    'registration',
    'permit',
    'inspection',
    'other',
]);
export const VehicleDocumentSchema = z.object({
    id: UuidSchema,
    type: VehicleDocumentTypeSchema,
    label: z.string().min(1).max(128),
    file_key: z.string().min(1).max(512),
    expires_at: IsoDateSchema.nullable(),
    uploaded_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------
export const VehicleSchema = TimestampsSchema.extend({
    id: UuidSchema,
    org_id: UuidSchema,
    registration: z.string().min(1).max(32),
    make: z.string().min(1).max(128),
    model: z.string().min(1).max(128),
    year: z.number().int().min(1900).max(2100),
    vin: z
        .string()
        .length(17)
        .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'Must be a valid 17-char VIN')
        .nullable(),
    type: VehicleTypeSchema,
    status: VehicleStatusSchema,
    assigned_driver_id: UuidSchema.nullable(),
    current_driver_id: UuidSchema.nullable(),
    odometer_km: z.number().nonnegative().nullable(),
    fuel_capacity_l: z.number().positive().nullable(),
    utilisation_pct: z.number().min(0).max(100).nullable(),
    documents: z.array(VehicleDocumentSchema),
});
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateVehicleInputSchema = z.object({
    org_id: UuidSchema,
    registration: z.string().min(1).max(32),
    make: z.string().min(1).max(128),
    model: z.string().min(1).max(128),
    year: z.number().int().min(1900).max(2100),
    vin: z
        .string()
        .length(17)
        .regex(/^[A-HJ-NPR-Z0-9]{17}$/)
        .nullable()
        .optional(),
    type: VehicleTypeSchema,
    status: VehicleStatusSchema.optional().default('active'),
});
export const UpdateVehicleInputSchema = z.object({
    registration: z.string().min(1).max(32).optional(),
    make: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(128).optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    vin: z
        .string()
        .length(17)
        .regex(/^[A-HJ-NPR-Z0-9]{17}$/)
        .nullable()
        .optional(),
    type: VehicleTypeSchema.optional(),
    status: VehicleStatusSchema.optional(),
    assigned_driver_id: UuidSchema.nullable().optional(),
    current_driver_id: UuidSchema.nullable().optional(),
    odometer_km: z.number().nonnegative().nullable().optional(),
    fuel_capacity_l: z.number().positive().nullable().optional(),
    utilisation_pct: z.number().min(0).max(100).nullable().optional(),
}).refine((obj) => Object.values(obj).some((v) => v !== undefined), { message: 'At least one field must be provided for update' });
