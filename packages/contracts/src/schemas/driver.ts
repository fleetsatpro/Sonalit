import { z } from 'zod';
import { UuidSchema, IsoDateSchema, TimestampsSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const DriverStatusSchema = z.enum(['active', 'inactive', 'suspended']);
export type DriverStatus = z.infer<typeof DriverStatusSchema>;

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
export type Driver = z.infer<typeof DriverSchema>;

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
export type CreateDriverInput = z.infer<typeof CreateDriverInputSchema>;

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
}).refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
);
export type UpdateDriverInput = z.infer<typeof UpdateDriverInputSchema>;
