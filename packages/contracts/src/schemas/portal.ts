import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// PortalConvoyView — cargo owner read-only view of a convoy
// ---------------------------------------------------------------------------

export const PortalConvoyStatusSchema = z.enum([
  'pending',
  'in_transit',
  'completed',
  'cancelled',
]);
export type PortalConvoyStatus = z.infer<typeof PortalConvoyStatusSchema>;

export const PortalConvoyViewSchema = z.object({
  convoy_id: UuidSchema,
  org_id: UuidSchema,
  reference: z.string().min(1).max(64),
  status: PortalConvoyStatusSchema,
  origin: z.string().min(1).max(256),
  destination: z.string().min(1).max(256),
  departed_at: IsoDateTimeSchema.nullable(),
  arrived_at: IsoDateTimeSchema.nullable(),
  estimated_arrival_at: IsoDateTimeSchema.nullable(),
  vehicle_count: z.number().int().nonnegative(),
  last_known_lat: z.number().min(-90).max(90).nullable(),
  last_known_lng: z.number().min(-180).max(180).nullable(),
  last_location_at: IsoDateTimeSchema.nullable(),
  seal_intact: z.boolean().nullable(),
  cargo_owner_ref: z.string().max(128).nullable(),
});
export type PortalConvoyView = z.infer<typeof PortalConvoyViewSchema>;

// ---------------------------------------------------------------------------
// PortalAccessToken — short-lived token issued to a cargo owner
// ---------------------------------------------------------------------------

export const PortalAccessTokenSchema = z.object({
  token: z.string().min(1),
  convoy_id: UuidSchema,
  org_id: UuidSchema,
  issued_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
  cargo_owner_ref: z.string().max(128).nullable(),
});
export type PortalAccessToken = z.infer<typeof PortalAccessTokenSchema>;

// ---------------------------------------------------------------------------
// PortalTokenRequest — request body for issuing a portal token
// ---------------------------------------------------------------------------

export const PortalTokenRequestSchema = z.object({
  convoy_id: UuidSchema,
  cargo_owner_ref: z.string().max(128).optional(),
  ttl_hours: z.number().int().min(1).max(168).default(24),
});
export type PortalTokenRequest = z.infer<typeof PortalTokenRequestSchema>;
