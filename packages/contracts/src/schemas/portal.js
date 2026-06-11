import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, LatLngSchema } from './common.js';
// ---------------------------------------------------------------------------
// PortalConvoyView — cargo owner read-only view of a convoy
// ---------------------------------------------------------------------------
export const PortalConvoyStatusSchema = z.enum([
    'pending',
    'in_transit',
    'completed',
    'cancelled',
]);
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
// ---------------------------------------------------------------------------
// PortalTokenRequest — request body for issuing a portal token
// ---------------------------------------------------------------------------
export const PortalTokenRequestSchema = z.object({
    convoy_id: UuidSchema,
    cargo_owner_ref: z.string().max(128).optional(),
    ttl_hours: z.number().int().min(1).max(168).default(24),
});
// ---------------------------------------------------------------------------
// V3 — CargoClient + auth
// ---------------------------------------------------------------------------
export const CargoClientSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    email: z.string().email(),
    name: z.string().min(1).max(128),
    company: z.string().max(128).nullable(),
    created_at: IsoDateTimeSchema,
    last_login_at: IsoDateTimeSchema.nullable(),
});
export const CargoClientLinkSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    client_id: UuidSchema,
    convoy_id: UuidSchema,
    shipment_id: UuidSchema.nullable(),
    show_value: z.boolean().default(false),
    created_at: IsoDateTimeSchema,
});
export const ClientMagicLinkSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    client_id: UuidSchema,
    token_hash: z.string().length(64),
    expires_at: IsoDateTimeSchema,
    used_at: IsoDateTimeSchema.nullable(),
});
export const ClientSessionSchema = z.object({
    client_id: UuidSchema,
    org_id: UuidSchema,
    convoy_ids: z.array(UuidSchema),
    exp: z.number().int().positive(),
});
// ---------------------------------------------------------------------------
// V3 — Shipment manifest
// ---------------------------------------------------------------------------
export const ManifestHandlingSchema = z.enum([
    'standard', 'fragile', 'hazmat', 'cold_chain', 'high_value',
]);
export const ManifestItemSchema = z.object({
    id: UuidSchema.optional(),
    description: z.string().min(1).max(512),
    quantity: z.number().int().positive(),
    weight_kg: z.number().nonnegative().nullable(),
    value: z.number().nonnegative().nullable(),
    currency: z.string().length(3).nullable(),
    handling: ManifestHandlingSchema.default('standard'),
});
export const ShipmentManifestSchema = z.object({
    shipment_id: UuidSchema,
    org_id: UuidSchema,
    items: z.array(ManifestItemSchema),
    total_weight_kg: z.number().nonnegative().nullable(),
    declared_value: z.number().nonnegative().nullable(),
    customs_ref: z.string().max(64).nullable(),
});
// ---------------------------------------------------------------------------
// V3 — Proof of delivery
// ---------------------------------------------------------------------------
export const ProofOfDeliverySchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    convoy_id: UuidSchema,
    shipment_id: UuidSchema.nullable(),
    delivered_at: IsoDateTimeSchema,
    recipient_name: z.string().min(1).max(128),
    signature_url: z.string().url().nullable(),
    photo_urls: z.array(z.string().url()),
    location: LatLngSchema,
    notes: z.string().max(1024).nullable(),
    pod_pdf_url: z.string().url().nullable(),
    created_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// V3 — Portal exceptions
// ---------------------------------------------------------------------------
export const PortalExceptionTypeSchema = z.enum([
    'delay', 'route_deviation', 'incident', 'no_signal', 'seal_discrepancy',
]);
export const PortalExceptionSeveritySchema = z.enum(['info', 'warning', 'critical']);
export const PortalExceptionSchema = z.object({
    id: UuidSchema,
    convoy_id: UuidSchema,
    type: PortalExceptionTypeSchema,
    severity: PortalExceptionSeveritySchema,
    message: z.string().min(1).max(512),
    occurred_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// V3 — Notification preferences
// ---------------------------------------------------------------------------
export const NotificationEventSchema = z.enum([
    'departure', 'checkpoint', 'delay', 'arrival', 'incident', 'delivered',
]);
export const NotificationChannelSchema = z.enum(['email', 'sms', 'whatsapp']);
export const NotificationPrefSchema = z.object({
    client_id: UuidSchema,
    convoy_id: UuidSchema.nullable(),
    events: z.array(NotificationEventSchema),
    channels: z.array(NotificationChannelSchema),
});
// ---------------------------------------------------------------------------
// V3 — Sensor / cold-chain telemetry
// ---------------------------------------------------------------------------
export const SensorMetricSchema = z.enum([
    'temperature_c', 'humidity_pct', 'door_open', 'shock_g',
]);
export const SensorReadingSchema = z.object({
    convoy_id: UuidSchema,
    vehicle_id: UuidSchema,
    metric: SensorMetricSchema,
    value: z.number(),
    recorded_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// V3 — Document vault
// ---------------------------------------------------------------------------
export const PortalDocumentTypeSchema = z.enum([
    'custody_chain', 'proof_of_delivery', 'manifest', 'customs', 'insurance', 'seal_report',
]);
export const PortalDocumentSchema = z.object({
    id: UuidSchema,
    org_id: UuidSchema,
    convoy_id: UuidSchema,
    type: PortalDocumentTypeSchema,
    label: z.string().min(1).max(128),
    file_url: z.string().url(),
    created_at: IsoDateTimeSchema,
});
// ---------------------------------------------------------------------------
// V3 — Dashboard shipment summary
// ---------------------------------------------------------------------------
export const ShipmentSummarySchema = z.object({
    convoy_id: UuidSchema,
    reference: z.string().min(1).max(64),
    status: PortalConvoyStatusSchema,
    origin: z.string().nullable(),
    destination: z.string().nullable(),
    progress_pct: z.number().min(0).max(100).nullable(),
    eta: IsoDateTimeSchema.nullable(),
    last_ping_at: IsoDateTimeSchema.nullable(),
    exception_count: z.number().int().nonnegative(),
    seal_status: z.enum(['intact', 'compromised', 'unverified']).nullable(),
    current_location: LatLngSchema.nullable(),
});
// ---------------------------------------------------------------------------
// V4 — ConsignmentVehicle (vehicle in a convoy, seen by cargo client)
// ---------------------------------------------------------------------------
export const ConsignmentVehicleSchema = z.object({
    vehicle_id: UuidSchema,
    registration: z.string().min(1).max(20),
    make: z.string().max(64).nullable(),
    model: z.string().max(64).nullable(),
    type: z.string().max(64).nullable(),
    driver_name: z.string().max(128).nullable(),
    current_lat: z.number().min(-90).max(90).nullable(),
    current_lng: z.number().min(-180).max(180).nullable(),
    speed_kmh: z.number().nonnegative().nullable(),
    heading_deg: z.number().min(0).max(360).nullable(),
    last_ping_at: IsoDateTimeSchema.nullable(),
    carries_my_cargo: z.boolean(),
});
// ---------------------------------------------------------------------------
// V4 — ConvoyEscort (armed escort or reaction unit)
// ---------------------------------------------------------------------------
export const ConvoyEscortSchema = z.object({
    escort_id: UuidSchema,
    callsign: z.string().min(1).max(64),
    role: z.enum(['armed_escort', 'reaction_unit', 'traffic_management', 'medic']),
    company: z.string().max(128).nullable(),
    vehicle_registration: z.string().max(20).nullable(),
    current_lat: z.number().min(-90).max(90).nullable(),
    current_lng: z.number().min(-180).max(180).nullable(),
});
// ---------------------------------------------------------------------------
// V4 — PortalConvoyOverview (full convoy state for Deep Track view)
// ---------------------------------------------------------------------------
export const CustodyEventSchema = z.object({
    event_id: UuidSchema,
    seq: z.number().int().nonnegative(),
    kind: z.enum(['departure', 'checkpoint', 'handoff', 'seal_check', 'arrival', 'exception']),
    location: z.string().max(256).nullable(),
    timestamp: IsoDateTimeSchema,
    officer: z.string().max(128).nullable(),
    seal_intact: z.boolean().nullable(),
    hash: z.string().length(64),
    prev_hash: z.string().length(64).nullable(),
    verified: z.boolean(),
});
export const PortalConvoyOverviewSchema = z.object({
    convoy_id: UuidSchema,
    org_id: UuidSchema,
    reference: z.string().min(1).max(64),
    status: PortalConvoyStatusSchema,
    origin: z.string().min(1).max(256),
    destination: z.string().min(1).max(256),
    departed_at: IsoDateTimeSchema.nullable(),
    estimated_arrival_at: IsoDateTimeSchema.nullable(),
    arrived_at: IsoDateTimeSchema.nullable(),
    progress_pct: z.number().min(0).max(100).nullable(),
    eta_confidence_low: IsoDateTimeSchema.nullable(),
    eta_confidence_high: IsoDateTimeSchema.nullable(),
    vehicles: z.array(ConsignmentVehicleSchema),
    escorts: z.array(ConvoyEscortSchema),
    coload_count: z.number().int().nonnegative(),
    exception_count: z.number().int().nonnegative(),
    seal_status: z.enum(['intact', 'compromised', 'unverified']).nullable(),
    custody_events: z.array(CustodyEventSchema),
    waypoints: z.array(LatLngSchema),
});
// V4 — PortalSecurityStatus
export const SecurityLevelSchema = z.enum(['secure', 'warning', 'critical']);
export const PortalSecurityStatusSchema = z.object({
    convoy_id: UuidSchema,
    level: SecurityLevelSchema,
    headline: z.string().min(1).max(128),
    detail: z.string().min(1).max(256),
    escort_active: z.boolean(),
    seal_status: z.enum(['intact', 'compromised', 'unverified']).nullable(),
    last_checkin_at: IsoDateTimeSchema.nullable(),
});
// V4 — PortalIncident (sanitised)
export const PortalIncidentTypeSchema = z.enum(['deviation', 'unplanned_stop', 'sos', 'geofence', 'delay', 'seal']);
export const PortalIncidentStatusSchema = z.enum(['detected', 'responding', 'resolved']);
export const IncidentTimelineEventSchema = z.object({
    at: IsoDateTimeSchema,
    label: z.string().min(1).max(256),
    phase: PortalIncidentStatusSchema,
});
export const PortalIncidentSchema = z.object({
    id: UuidSchema,
    convoy_id: UuidSchema,
    type: PortalIncidentTypeSchema,
    severity: PortalExceptionSeveritySchema,
    title: z.string().min(1).max(128),
    summary: z.string().min(1).max(512),
    status: PortalIncidentStatusSchema,
    occurred_at: IsoDateTimeSchema,
    resolved_at: IsoDateTimeSchema.nullable(),
    timeline: z.array(IncidentTimelineEventSchema),
});
