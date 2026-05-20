import { z } from 'zod';
import { UuidSchema, TimestampsSchema } from './common.js';

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
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const VehicleStatusSchema = z.enum([
  'active',
  'inactive',
  'maintenance',
]);
export type VehicleStatus = z.infer<typeof VehicleStatusSchema>;

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
});
export type Vehicle = z.infer<typeof VehicleSchema>;

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
export type CreateVehicleInput = z.infer<typeof CreateVehicleInputSchema>;

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
}).refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
);
export type UpdateVehicleInput = z.infer<typeof UpdateVehicleInputSchema>;
