import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from '../schemas/common.js';
import { GpsFixBatchSchema } from '../schemas/telemetry.js';
import { PanicRequestSchema } from '../schemas/guardian.js';
import { AlertSchema } from '../schemas/alert.js';
import { CommandSchema } from '../schemas/guardian.js';
import { AuditLogWriteSchema } from '../schemas/audit.js';
import { ConvoySchema } from '../schemas/convoy.js';
import { CfoPhotoSchema } from '../schemas/cfo-photo.js';
import { OutboxChannelSchema } from '../schemas/outbox.js';

// ---------------------------------------------------------------------------
// NATS subject patterns
// Wildcards: * = single token, > = one or more tokens
// ---------------------------------------------------------------------------

export const NATS_SUBJECTS = {
  // Telemetry ingest — published by Guardian devices (batch)
  telemetry_gps: (orgId: string, deviceId: string) =>
    `telemetry.gps.${orgId}.${deviceId}` as const,
  telemetry_gps_pattern: 'telemetry.gps.*.*',

  // Panic events — published by Guardian service on panic trigger
  events_panic: (orgId: string) => `events.panic.${orgId}` as const,
  events_panic_pattern: 'events.panic.*',

  // Alert events — published by Alert service on creation
  events_alert: (orgId: string) => `events.alert.${orgId}` as const,
  events_alert_pattern: 'events.alert.*',

  // Geofence breach events — published by Geofence processor
  events_geofence_breach: (orgId: string) =>
    `events.geofence.breach.${orgId}` as const,
  events_geofence_breach_pattern: 'events.geofence.breach.*',

  // Commands — published by Command service, consumed by device gateway
  commands: (deviceId: string) => `commands.${deviceId}` as const,
  commands_pattern: 'commands.*',

  // Audit log entries — written by audit service
  audit: (service: string) => `audit.${service}` as const,
  audit_pattern: 'audit.*',

  // Outbound notifications (fan-out to FCM/APNS/email/etc.)
  notifications: (channel: string) => `notifications.${channel}` as const,
  notifications_pattern: 'notifications.*',

  // Convoy updates — published by Convoy service on any mutation
  convoy_updated: (orgId: string) => `convoy.updated.${orgId}` as const,
  convoy_updated_pattern: 'convoy.updated.*',

  // Media committed — published by Media service after photo commit
  media_committed: (orgId: string) => `media.committed.${orgId}` as const,
  media_committed_pattern: 'media.committed.*',
} as const;

// ---------------------------------------------------------------------------
// Typed event payloads
// ---------------------------------------------------------------------------

// telemetry.gps.<org>.<device>
export const TelemetryGpsEventSchema = GpsFixBatchSchema;
export type TelemetryGpsEvent = z.infer<typeof TelemetryGpsEventSchema>;

// events.panic.<org>
export const PanicEventSchema = PanicRequestSchema.extend({
  org_id: UuidSchema,
  device_name: z.string().min(1).max(128),
  assigned_user_id: UuidSchema.nullable(),
});
export type PanicEvent = z.infer<typeof PanicEventSchema>;

// events.alert.<org>
export const AlertEventSchema = AlertSchema;
export type AlertEvent = z.infer<typeof AlertEventSchema>;

// commands.<device>
export const CommandEventSchema = CommandSchema;
export type CommandEvent = z.infer<typeof CommandEventSchema>;

// audit.<service>  — id and prev_hash added by writer
export const AuditEventSchema = AuditLogWriteSchema;
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// convoy.updated.<org>
export const ConvoyUpdatedEventSchema = ConvoySchema;
export type ConvoyUpdatedEvent = z.infer<typeof ConvoyUpdatedEventSchema>;

// media.committed.<org>
export const MediaCommittedEventSchema = CfoPhotoSchema;
export type MediaCommittedEvent = z.infer<typeof MediaCommittedEventSchema>;

// ---------------------------------------------------------------------------
// Notification envelope — notifications.<channel>
// ---------------------------------------------------------------------------

export const NotificationEnvelopeSchema = z.object({
  id: UuidSchema,
  channel: OutboxChannelSchema,
  recipient: z.string().min(1).describe('FCM token, APNS token, email address, or phone'),
  title: z.string().max(256).nullable(),
  body: z.string().max(4096),
  data: z.record(z.string(), z.string()).optional(),
  priority: z.enum(['normal', 'high']),
  ttl_ms: z.number().int().positive().nullable(),
  idempotency_key: z.string().max(256).nullable(),
  created_at: IsoDateTimeSchema,
});
export type NotificationEnvelope = z.infer<typeof NotificationEnvelopeSchema>;

// ---------------------------------------------------------------------------
// JetStream stream configuration hints (informational)
// ---------------------------------------------------------------------------

export const STREAM_CONFIG = {
  TELEMETRY: {
    name: 'TELEMETRY',
    subjects: ['telemetry.gps.*.*'],
    max_age_ns: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days
    storage: 'file',
  },
  EVENTS: {
    name: 'EVENTS',
    subjects: ['events.*.*', 'events.*.*.>'],
    max_age_ns: 30 * 24 * 60 * 60 * 1_000_000_000, // 30 days
    storage: 'file',
  },
  COMMANDS: {
    name: 'COMMANDS',
    subjects: ['commands.*'],
    max_age_ns: 60 * 60 * 1_000_000_000, // 1 hour
    storage: 'memory',
  },
  AUDIT: {
    name: 'AUDIT',
    subjects: ['audit.*'],
    max_age_ns: 365 * 24 * 60 * 60 * 1_000_000_000, // 1 year
    storage: 'file',
  },
  NOTIFICATIONS: {
    name: 'NOTIFICATIONS',
    subjects: ['notifications.*'],
    max_age_ns: 24 * 60 * 60 * 1_000_000_000, // 24 hours
    storage: 'file',
  },
  CONVOY: {
    name: 'CONVOY',
    subjects: ['convoy.updated.*'],
    max_age_ns: 90 * 24 * 60 * 60 * 1_000_000_000, // 90 days
    storage: 'file',
  },
  MEDIA: {
    name: 'MEDIA',
    subjects: ['media.committed.*'],
    max_age_ns: 90 * 24 * 60 * 60 * 1_000_000_000, // 90 days
    storage: 'file',
  },
} as const;
