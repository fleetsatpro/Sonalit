import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, GeoJsonPolygonSchema, LatLngSchema } from './common.js';
import { AlertSeveritySchema } from './alert.js';
// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const GeofenceTypeSchema = z.enum(['inclusion', 'exclusion']);
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
    // S2-F1 Smart Geofencing extensions
    corridor_width_km: z.number().positive().nullable(),
    active_from_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    active_to_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    days_of_week: z.array(z.number().int().min(0).max(6)).nullable(),
    checkpoint_order: z.number().int().nullable(),
    dwell_alert_min: z.number().int().nullable(),
});
// ---------------------------------------------------------------------------
// Geofence Events (S2-F1)
// ---------------------------------------------------------------------------
export const GeofenceEventTypeSchema = z.enum([
    'enter', 'exit', 'dwell_exceeded', 'route_deviation', 'checkpoint_signin',
]);
export const GeofenceEventSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    geofence_id: UuidSchema,
    vehicle_id: UuidSchema.nullable(),
    device_id: UuidSchema.nullable(),
    convoy_id: UuidSchema.nullable(),
    event_type: GeofenceEventTypeSchema,
    location: LatLngSchema,
    dwell_minutes: z.number().nullable(),
    deviation_km: z.number().nullable(),
    created_at: IsoDateTimeSchema,
});
export const ConvoyRouteCorridorSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    convoy_id: UuidSchema,
    route_line: z.array(LatLngSchema),
    width_km: z.number().positive().default(2.0),
    active: z.boolean().default(true),
    created_at: IsoDateTimeSchema,
});
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
export const UpdateGeofenceInputSchema = z.object({
    name: z.string().min(1).max(256).optional(),
    type: GeofenceTypeSchema.optional(),
    polygon: GeoJsonPolygonSchema.optional(),
    active: z.boolean().optional(),
    trigger_on_entry: z.boolean().optional(),
    trigger_on_exit: z.boolean().optional(),
    alert_severity: AlertSeveritySchema.optional(),
}).refine((obj) => Object.values(obj).some((v) => v !== undefined), { message: 'At least one field must be provided for update' });
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
