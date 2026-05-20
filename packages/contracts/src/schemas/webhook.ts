import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// WebhookEvent enum
// ---------------------------------------------------------------------------

export const WebhookEventSchema = z.enum([
  'alert.created',
  'alert.acknowledged',
  'alert.resolved',
  'panic.triggered',
  'panic.resolved',
  'convoy.created',
  'convoy.updated',
  'convoy.status_changed',
  'convoy.completed',
  'convoy.cancelled',
  'vehicle.created',
  'vehicle.updated',
  'vehicle.status_changed',
  'driver.created',
  'driver.updated',
  'driver.status_changed',
  'device.enrolled',
  'device.revoked',
  'device.integrity_failed',
  'incident.created',
  'incident.updated',
  'incident.closed',
  'photo.committed',
  'geofence.entered',
  'geofence.exited',
  'maintenance.due',
  'maintenance.completed',
]);
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export const WebhookSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  url: z.string().url(),
  events: z
    .array(WebhookEventSchema)
    .min(1, 'At least one event type must be subscribed'),
  secret_hash: z.string().describe('Argon2id hash of the webhook signing secret'),
  active: z.boolean(),
  created_at: IsoDateTimeSchema,
  last_triggered_at: IsoDateTimeSchema.nullable(),
  failure_count: z.number().int().nonnegative(),
});
export type Webhook = z.infer<typeof WebhookSchema>;

// ---------------------------------------------------------------------------
// Public projection (no secret_hash)
// ---------------------------------------------------------------------------

export const WebhookPublicSchema = WebhookSchema.omit({ secret_hash: true });
export type WebhookPublic = z.infer<typeof WebhookPublicSchema>;

// ---------------------------------------------------------------------------
// WebhookDelivery
// ---------------------------------------------------------------------------

export const WebhookDeliverySchema = z.object({
  id: UuidSchema,
  webhook_id: UuidSchema,
  event: WebhookEventSchema,
  payload: z.record(z.string(), z.string()).describe('JSON payload as string map'),
  status_code: z.number().int().min(100).max(599).nullable(),
  response_body: z.string().max(4096).nullable(),
  attempted_at: IsoDateTimeSchema,
  next_retry_at: IsoDateTimeSchema.nullable(),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CreateWebhookInputSchema = z.object({
  org_id: UuidSchema,
  url: z.string().url(),
  events: z.array(WebhookEventSchema).min(1),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInputSchema>;

export const UpdateWebhookInputSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(WebhookEventSchema).min(1).optional(),
  active: z.boolean().optional(),
}).refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
);
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookInputSchema>;
