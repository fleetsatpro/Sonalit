import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

export const ResponseTeamStatusSchema = z.enum(['standby', 'deployed', 'offline']);
export type ResponseTeamStatus = z.infer<typeof ResponseTeamStatusSchema>;

export const ResponseTeamTypeSchema = z.enum([
  'reaction', 'armed_response', 'recovery', 'tactical',
]);
export type ResponseTeamType = z.infer<typeof ResponseTeamTypeSchema>;

export const DispatchPrioritySchema = z.enum(['critical', 'high', 'medium']);
export type DispatchPriority = z.infer<typeof DispatchPrioritySchema>;

export const DispatchStatusSchema = z.enum([
  'dispatched', 'acknowledged', 'en_route', 'on_scene', 'resolved', 'cancelled',
]);
export type DispatchStatus = z.infer<typeof DispatchStatusSchema>;

export const ResponseTeamSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  name: z.string().min(1).max(128),
  type: ResponseTeamTypeSchema,
  callsign: z.string().max(32).nullable(),
  location: z.string().max(256).nullable(),
  base_lat: z.number().nullable(),
  base_lng: z.number().nullable(),
  eta_minutes: z.number().int().nonnegative(),
  status: ResponseTeamStatusSchema,
  active: z.boolean(),
  created_at: IsoDateTimeSchema,
});
export type ResponseTeam = z.infer<typeof ResponseTeamSchema>;

export const InterceptDispatchSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  team_id: UuidSchema,
  alert_id: UuidSchema.nullable(),
  panic_id: UuidSchema.nullable(),
  convoy_id: UuidSchema.nullable(),
  vehicle_id: UuidSchema.nullable(),
  priority: DispatchPrioritySchema,
  status: DispatchStatusSchema,
  reason: z.string().min(1).max(512),
  target_lat: z.number(),
  target_lng: z.number(),
  target_label: z.string().max(256).nullable(),
  dispatched_by: UuidSchema.nullable(),
  dispatched_at: IsoDateTimeSchema,
  acknowledged_at: IsoDateTimeSchema.nullable(),
  arrived_at: IsoDateTimeSchema.nullable(),
  resolved_at: IsoDateTimeSchema.nullable(),
  resolution_note: z.string().max(1024).nullable(),
});
export type InterceptDispatch = z.infer<typeof InterceptDispatchSchema>;

export const CreateDispatchInputSchema = z.object({
  team_id: UuidSchema,
  alert_id: UuidSchema.optional(),
  panic_id: UuidSchema.optional(),
  convoy_id: UuidSchema.optional(),
  vehicle_id: UuidSchema.optional(),
  priority: DispatchPrioritySchema.default('high'),
  reason: z.string().min(1).max(512),
  target_lat: z.number(),
  target_lng: z.number(),
  target_label: z.string().max(256).optional(),
});
export type CreateDispatchInput = z.infer<typeof CreateDispatchInputSchema>;
