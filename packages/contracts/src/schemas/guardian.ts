import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, SoftDeleteSchema, TimestampsSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const DeviceStatusSchema = z.enum([
  'pending',
  'active',
  'revoked',
  'suspended',
]);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export const AssignmentTypeSchema = z.enum(['user', 'vehicle', 'unassigned']);
export type AssignmentType = z.infer<typeof AssignmentTypeSchema>;

export const PlayIntegrityVerdictSchema = z.enum([
  'MEETS_DEVICE_INTEGRITY',
  'MEETS_BASIC_INTEGRITY',
  'FAILS',
]);
export type PlayIntegrityVerdict = z.infer<typeof PlayIntegrityVerdictSchema>;

export const CommandTypeSchema = z.enum([
  'CHANGE_MODE',
  'LOCKDOWN',
  'WIPE',
  'SEND_MESSAGE',
  'TAKE_PHOTO',
  'UPDATE_PINS',
]);
export type CommandType = z.infer<typeof CommandTypeSchema>;

export const PanicTriggerTypeSchema = z.enum([
  'manual',
  'dms_timeout',
  'dms_missed_check_in',
  'geofence_breach',
  'impact_detected',
  'api',
]);
export type PanicTriggerType = z.infer<typeof PanicTriggerTypeSchema>;

// ---------------------------------------------------------------------------
// IntegrityVerdict
// ---------------------------------------------------------------------------

export const IntegrityVerdictSchema = z.object({
  deviceIntegrity: z.boolean(),
  basicIntegrity: z.boolean(),
  appIntegrity: z.boolean(),
  verdictString: PlayIntegrityVerdictSchema,
  tokenTime: IsoDateTimeSchema,
});
export type IntegrityVerdict = z.infer<typeof IntegrityVerdictSchema>;

// ---------------------------------------------------------------------------
// GuardianDevice
// ---------------------------------------------------------------------------

export const GuardianDeviceSchema = SoftDeleteSchema.extend({
  id: UuidSchema,
  org_id: UuidSchema,
  imei: z
    .string()
    .regex(/^\d{15,17}$/, 'IMEI must be 15-17 digits')
    .nullable(),
  android_id: z.string().min(1).max(64),
  manufacturer: z.string().min(1).max(128),
  model: z.string().min(1).max(128),
  os_version: z.string().min(1).max(64),
  app_version: z.string().min(1).max(32),
  name: z.string().min(1).max(128),
  token_hash: z.string().describe('Argon2id hash of the device token'),
  status: DeviceStatusSchema,
  assignment_type: AssignmentTypeSchema,
  assignment_id: UuidSchema.nullable(),
  play_integrity_verdict: PlayIntegrityVerdictSchema.nullable(),
  integrity_checked_at: IsoDateTimeSchema.nullable(),
  dms_enabled: z.boolean(),
  dms_timeout_minutes: z.number().int().min(1).max(1440).nullable(),
  dms_suspended_until: IsoDateTimeSchema.nullable(),
});
export type GuardianDevice = z.infer<typeof GuardianDeviceSchema>;

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const CommandSchema = z.object({
  id: UuidSchema,
  device_id: UuidSchema,
  type: CommandTypeSchema,
  payload: z.record(z.string(), z.string()),
  issued_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
  acked_at: IsoDateTimeSchema.nullable(),
});
export type Command = z.infer<typeof CommandSchema>;

// ---------------------------------------------------------------------------
// Enroll
// ---------------------------------------------------------------------------

export const EnrollRequestSchema = z.object({
  org_id: UuidSchema,
  android_id: z.string().min(1).max(64),
  imei: z
    .string()
    .regex(/^\d{15,17}$/)
    .nullable()
    .optional(),
  manufacturer: z.string().min(1).max(128),
  model: z.string().min(1).max(128),
  os_version: z.string().min(1).max(64),
  app_version: z.string().min(1).max(32),
  name: z.string().min(1).max(128),
  enroll_token: z.string().min(1).describe('One-time enrollment token'),
});
export type EnrollRequest = z.infer<typeof EnrollRequestSchema>;

export const EnrollResponseSchema = z.object({
  device_id: UuidSchema,
  device_token: z.string().min(1).describe('Bearer token for subsequent requests'),
  status: DeviceStatusSchema,
});
export type EnrollResponse = z.infer<typeof EnrollResponseSchema>;

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export const HeartbeatRequestSchema = z.object({
  device_id: UuidSchema,
  app_version: z.string().min(1).max(32),
  battery_pct: z.number().int().min(0).max(100).nullable(),
  is_charging: z.boolean().nullable(),
  network_type: z.enum(['wifi', 'cellular', 'ethernet', 'none']).nullable(),
  timestamp: IsoDateTimeSchema,
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export const HeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  pending_commands: z.array(CommandSchema),
  server_time: IsoDateTimeSchema,
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

// ---------------------------------------------------------------------------
// Panic
// ---------------------------------------------------------------------------

export const PanicRequestSchema = z.object({
  device_id: UuidSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable(),
  note: z.string().max(512).nullable().optional(),
  timestamp: IsoDateTimeSchema,
  trigger_type: PanicTriggerTypeSchema.optional().default('manual'),
});
export type PanicRequest = z.infer<typeof PanicRequestSchema>;

export const PanicResponseSchema = z.object({
  ok: z.literal(true),
  alert_id: UuidSchema,
});
export type PanicResponse = z.infer<typeof PanicResponseSchema>;

// ---------------------------------------------------------------------------
// Command Ack
// ---------------------------------------------------------------------------

export const AckRequestSchema = z.object({
  command_id: UuidSchema,
  device_id: UuidSchema,
  acked_at: IsoDateTimeSchema,
});
export type AckRequest = z.infer<typeof AckRequestSchema>;

// ---------------------------------------------------------------------------
// CFO Login
// ---------------------------------------------------------------------------

export const CfoLoginRequestSchema = z.object({
  device_id: UuidSchema,
  user_pin: z.string().min(4).max(16),
  convoy_id: UuidSchema.optional(),
});
export type CfoLoginRequest = z.infer<typeof CfoLoginRequestSchema>;

export const CfoLoginResponseSchema = z.object({
  ok: z.literal(true),
  session_token: z.string().min(1),
  expires_at: IsoDateTimeSchema,
  user_id: UuidSchema,
  org_id: UuidSchema,
});
export type CfoLoginResponse = z.infer<typeof CfoLoginResponseSchema>;

// ---------------------------------------------------------------------------
// Photo Upload URL
// ---------------------------------------------------------------------------

export const PhotoUploadUrlRequestSchema = z.object({
  device_id: UuidSchema,
  event_uuid: UuidSchema,
  convoy_id: UuidSchema,
  convoy_truck_id: UuidSchema,
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  file_size_bytes: z.number().int().min(1).max(20 * 1024 * 1024),
});
export type PhotoUploadUrlRequest = z.infer<typeof PhotoUploadUrlRequestSchema>;

export const PhotoUploadUrlResponseSchema = z.object({
  upload_url: z.string().url().describe('Pre-signed PUT URL'),
  object_key: z.string().min(1),
  expires_at: IsoDateTimeSchema,
});
export type PhotoUploadUrlResponse = z.infer<typeof PhotoUploadUrlResponseSchema>;

// ---------------------------------------------------------------------------
// Photo Commit
// ---------------------------------------------------------------------------

export const PhotoCommitRequestSchema = z.object({
  device_id: UuidSchema,
  event_uuid: UuidSchema,
  object_key: z.string().min(1),
  taken_at: IsoDateTimeSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  session: z.enum(['sod', 'eod']),
  photo_type: z.enum(['front', 'rear', 'seal', 'cab', 'cargo', 'other']),
  seal_position: z.number().int().min(1).nullable().optional(),
  notes: z.string().max(1024).nullable().optional(),
});
export type PhotoCommitRequest = z.infer<typeof PhotoCommitRequestSchema>;

export const PhotoCommitResponseSchema = z.object({
  ok: z.literal(true),
  photo_id: UuidSchema,
  committed_at: IsoDateTimeSchema,
});
export type PhotoCommitResponse = z.infer<typeof PhotoCommitResponseSchema>;

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

export const IntegrityCheckRequestSchema = z.object({
  device_id: UuidSchema,
  integrity_token: z.string().min(1),
  nonce: z.string().min(16),
});
export type IntegrityCheckRequest = z.infer<typeof IntegrityCheckRequestSchema>;

export const IntegrityCheckResponseSchema = z.object({
  ok: z.literal(true),
  verdict: IntegrityVerdictSchema,
  checked_at: IsoDateTimeSchema,
});
export type IntegrityCheckResponse = z.infer<typeof IntegrityCheckResponseSchema>;

// ---------------------------------------------------------------------------
// Device list (public projection, no token_hash)
// ---------------------------------------------------------------------------

export const GuardianDevicePublicSchema = GuardianDeviceSchema.omit({
  token_hash: true,
});
export type GuardianDevicePublic = z.infer<typeof GuardianDevicePublicSchema>;

// ---------------------------------------------------------------------------
// Track guardian device update (admin operations)
// ---------------------------------------------------------------------------

export const UpdateGuardianDeviceInputSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  status: DeviceStatusSchema.optional(),
  assignment_type: AssignmentTypeSchema.optional(),
  assignment_id: UuidSchema.nullable().optional(),
}).refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
);
export type UpdateGuardianDeviceInput = z.infer<typeof UpdateGuardianDeviceInputSchema>;

// Re-export TimestampsSchema usage for test compatibility
export { TimestampsSchema };
