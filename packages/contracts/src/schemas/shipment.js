import { z } from 'zod';
import { UuidSchema, TimestampsSchema } from './common.js';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const ShipmentStatusSchema = z.enum([
    'draft',
    'pending',
    'in_transit',
    'delivered',
    'returned',
    'cancelled',
]);
// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------
export const ShipmentLocationSchema = z.object({
    address: z.string().min(1).max(512),
    city: z.string().min(1).max(128),
    country: z
        .string()
        .length(2)
        .describe('ISO 3166-1 alpha-2 country code'),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
});
// ---------------------------------------------------------------------------
// Shipment
// ---------------------------------------------------------------------------
export const ShipmentSchema = TimestampsSchema.extend({
    id: UuidSchema,
    org_id: UuidSchema,
    convoy_id: UuidSchema.nullable(),
    origin: ShipmentLocationSchema,
    destination: ShipmentLocationSchema,
    status: ShipmentStatusSchema,
    manifest_url: z.string().url().nullable().describe('Link to shipping manifest document'),
});
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateShipmentInputSchema = z.object({
    org_id: UuidSchema,
    convoy_id: UuidSchema.nullable().optional(),
    origin: ShipmentLocationSchema,
    destination: ShipmentLocationSchema,
    manifest_url: z.string().url().nullable().optional(),
});
export const UpdateShipmentInputSchema = z.object({
    convoy_id: UuidSchema.nullable().optional(),
    origin: ShipmentLocationSchema.optional(),
    destination: ShipmentLocationSchema.optional(),
    status: ShipmentStatusSchema.optional(),
    manifest_url: z.string().url().nullable().optional(),
}).refine((obj) => Object.values(obj).some((v) => v !== undefined), { message: 'At least one field must be provided for update' });
