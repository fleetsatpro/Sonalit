import { z } from 'zod';
import { UuidSchema, IsoDateSchema, IsoDateTimeSchema, TimestampsSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums — these mirror the backend's Joi validators and the vehicles table
// CHECK constraints exactly. They were previously an aspirational set
// ('truck'/'pickup'…, 'inactive'/'retired') that the API rejected, which left
// the Fleet UI issuing doomed requests and rendering unknown statuses.
// ---------------------------------------------------------------------------

export const VehicleTypeSchema = z.enum([
  'SUV',
  'Truck',
  'APC',
  'Motorcycle',
  'Van',
]);
export type VehicleType = z.infer<typeof VehicleTypeSchema>;

export const VehicleRegionSchema = z.enum([
  'Kenya',
  'DRC',
  'Tanzania',
  'Mali',
]);
export type VehicleRegion = z.infer<typeof VehicleRegionSchema>;

export const VehicleStatusSchema = z.enum([
  'idle',
  'active',
  'maintenance',
  'offline',
]);
export type VehicleStatus = z.infer<typeof VehicleStatusSchema>;

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
export type VehicleDocumentType = z.infer<typeof VehicleDocumentTypeSchema>;

export const VehicleDocumentSchema = z.object({
  id: UuidSchema,
  type: VehicleDocumentTypeSchema,
  label: z.string().min(1).max(128),
  file_key: z.string().min(1).max(512),
  expires_at: IsoDateSchema.nullable(),
  uploaded_at: IsoDateTimeSchema,
});
export type VehicleDocument = z.infer<typeof VehicleDocumentSchema>;

// ---------------------------------------------------------------------------
// Vehicle — the shape GET /vehicles actually returns (vehicles row plus the
// driver join). Identity fields are nullable because the fleet predates them
// being settable through the API.
// ---------------------------------------------------------------------------

export const VehicleSchema = TimestampsSchema.extend({
  id: UuidSchema,
  org_id: UuidSchema,
  registration: z.string().min(1).max(50),
  type: VehicleTypeSchema,
  region: VehicleRegionSchema,
  status: VehicleStatusSchema,
  capacity: z.number().int().nullable(),
  make: z.string().max(128).nullable(),
  model: z.string().max(128).nullable(),
  year: z.number().int().min(1900).max(2100).nullable(),
  vin: z.string().max(50).nullable(),
  color: z.string().max(50).nullable(),
  latitude: z.coerce.number().nullable(),
  longitude: z.coerce.number().nullable(),
  last_ping: IsoDateTimeSchema.nullable(),
  insurance_expiry: IsoDateTimeSchema.nullable(),
  inspection_expiry: IsoDateTimeSchema.nullable(),
  driver_id: UuidSchema.nullable(),
  assigned_convoy_id: UuidSchema.nullable(),
  // Joined by the list/detail endpoints.
  driver_name: z.string().nullable().optional(),
  driver_email: z.string().nullable().optional(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

// ---------------------------------------------------------------------------
// Mutations — mirror backend/src/controllers/vehicleController.js
// ---------------------------------------------------------------------------

export const CreateVehicleInputSchema = z.object({
  registration: z.string().min(3).max(20),
  type: VehicleTypeSchema,
  region: VehicleRegionSchema,
  capacity: z.number().int().min(1).max(50),
  driverId: UuidSchema.nullable().optional(),
  make: z.string().max(100).nullable().optional(),
  model: z.string().max(100).nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  vin: z.string().max(50).nullable().optional(),
  color: z.string().max(50).nullable().optional(),
});
export type CreateVehicleInput = z.infer<typeof CreateVehicleInputSchema>;

export const UpdateVehicleInputSchema = CreateVehicleInputSchema.partial().refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
);
export type UpdateVehicleInput = z.infer<typeof UpdateVehicleInputSchema>;
