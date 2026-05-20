import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, TimestampsSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const MaintenanceTypeSchema = z.enum([
  'oil_change',
  'tyre_rotation',
  'brake_service',
  'engine_service',
  'transmission_service',
  'electrical',
  'body_repair',
  'inspection',
  'certification',
  'other',
]);
export type MaintenanceType = z.infer<typeof MaintenanceTypeSchema>;

export const MaintenanceStatusSchema = z.enum([
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
]);
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusSchema>;

// ---------------------------------------------------------------------------
// MaintenanceRecord
// ---------------------------------------------------------------------------

export const MaintenanceRecordSchema = TimestampsSchema.extend({
  id: UuidSchema,
  org_id: UuidSchema,
  vehicle_id: UuidSchema,
  type: MaintenanceTypeSchema,
  description: z.string().max(2048),
  status: MaintenanceStatusSchema,
  scheduled_at: IsoDateTimeSchema,
  completed_at: IsoDateTimeSchema.nullable(),
  cost_cents: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe('Cost in smallest currency unit (e.g. cents)'),
  notes: z.string().max(4096).nullable(),
});
export type MaintenanceRecord = z.infer<typeof MaintenanceRecordSchema>;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CreateMaintenanceRecordInputSchema = z.object({
  org_id: UuidSchema,
  vehicle_id: UuidSchema,
  type: MaintenanceTypeSchema,
  description: z.string().max(2048).default(''),
  status: MaintenanceStatusSchema.default('scheduled'),
  scheduled_at: IsoDateTimeSchema,
  cost_cents: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(4096).nullable().optional(),
});
export type CreateMaintenanceRecordInput = z.infer<typeof CreateMaintenanceRecordInputSchema>;

export const UpdateMaintenanceRecordInputSchema = z.object({
  type: MaintenanceTypeSchema.optional(),
  description: z.string().max(2048).optional(),
  status: MaintenanceStatusSchema.optional(),
  scheduled_at: IsoDateTimeSchema.optional(),
  completed_at: IsoDateTimeSchema.nullable().optional(),
  cost_cents: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(4096).nullable().optional(),
}).refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
);
export type UpdateMaintenanceRecordInput = z.infer<typeof UpdateMaintenanceRecordInputSchema>;
