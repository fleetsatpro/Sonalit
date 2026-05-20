import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, GeoJsonPolygonSchema } from './common.js';
import { AlertSeveritySchema } from './alert.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const GeofenceTypeSchema = z.enum(['inclusion', 'exclusion']);
export type GeofenceType = z.infer<typeof GeofenceTypeSchema>;

// ---------------------------------------------------------------------------
// Geofence
// ---------------------------------------------------------------------------

export const GeofenceSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  name: z.string().min(1).max(256),
  type: GeofenceTypeSchema,
  polygon: GeoJsonPolygonSchema,
  active: z.boolean(),
  trigger_on_entry: z.boolean(),
  trigger_on_exit: z.boolean(),
  alert_severity: AlertSeveritySchema,
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type Geofence = z.infer<typeof GeofenceSchema>;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CreateGeofenceInputSchema = z.object({
  org_id: UuidSchema,
  name: z.string().min(1).max(256),
  type: GeofenceTypeSchema,
  polygon: GeoJsonPolygonSchema,
  active: z.boolean().default(true),
  trigger_on_entry: z.boolean().default(true),
  trigger_on_exit: z.boolean().default(false),
  alert_severity: AlertSeveritySchema.default('warning'),
});
export type CreateGeofenceInput = z.infer<typeof CreateGeofenceInputSchema>;

export const UpdateGeofenceInputSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  type: GeofenceTypeSchema.optional(),
  polygon: GeoJsonPolygonSchema.optional(),
  active: z.boolean().optional(),
  trigger_on_entry: z.boolean().optional(),
  trigger_on_exit: z.boolean().optional(),
  alert_severity: AlertSeveritySchema.optional(),
}).refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
);
export type UpdateGeofenceInput = z.infer<typeof UpdateGeofenceInputSchema>;

// ---------------------------------------------------------------------------
// Geofence breach event (emitted by telemetry processor)
// ---------------------------------------------------------------------------

export const GeofenceBreachEventSchema = z.object({
  geofence_id: UuidSchema,
  device_id: UuidSchema,
  org_id: UuidSchema,
  breach_type: z.enum(['entry', 'exit']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timestamp: IsoDateTimeSchema,
});
export type GeofenceBreachEvent = z.infer<typeof GeofenceBreachEventSchema>;
