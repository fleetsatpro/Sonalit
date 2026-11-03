import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const BroadcastChannelSchema = z.enum(['in_app', 'whatsapp', 'sms', 'push']);
export type BroadcastChannel = z.infer<typeof BroadcastChannelSchema>;

// ---------------------------------------------------------------------------
// Convoy Broadcast
// ---------------------------------------------------------------------------

export const ConvoyBroadcastSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  convoy_id: UuidSchema,
  sender_id: UuidSchema,
  message: z.string().max(1000),
  channels: z.array(BroadcastChannelSchema),
  canned_message_id: UuidSchema.nullable(),
  delivery_summary: z.record(z.string(), z.enum(['pending', 'delivered', 'failed'])),
  created_at: IsoDateTimeSchema,
});
export type ConvoyBroadcast = z.infer<typeof ConvoyBroadcastSchema>;

// ---------------------------------------------------------------------------
// Canned Message
// ---------------------------------------------------------------------------

export const CannedMessageSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  label: z.string(),
  body: z.string(),
  category: z.enum(['security', 'logistics', 'emergency', 'general']),
  channels: z.array(BroadcastChannelSchema),
});
export type CannedMessage = z.infer<typeof CannedMessageSchema>;

// ---------------------------------------------------------------------------
// WhatsApp Config (never returns plain/encrypted token to client)
// ---------------------------------------------------------------------------

export const WhatsAppConfigSchema = z.object({
  org_id: UuidSchema,
  phone_number_id: z.string(),
  waba_id: z.string(),
  access_token_hash: z.string(),
  webhook_verify_token_hash: z.string(),
  enabled: z.boolean(),
});
export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;
