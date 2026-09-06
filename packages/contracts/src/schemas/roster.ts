import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ShiftRoleSchema = z.enum(['dispatcher', 'analyst', 'supervisor', 'field_officer', 'response_crew']);
export type ShiftRole = z.infer<typeof ShiftRoleSchema>;

// ---------------------------------------------------------------------------
// Shift
// ---------------------------------------------------------------------------

export const ShiftSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  user_id: UuidSchema,
  role: ShiftRoleSchema,
  starts_at: IsoDateTimeSchema,
  ends_at: IsoDateTimeSchema,
  convoy_ids: z.array(UuidSchema).default([]),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});
export type Shift = z.infer<typeof ShiftSchema>;

// ---------------------------------------------------------------------------
// Shift Handover
// ---------------------------------------------------------------------------

export const ShiftHandoverSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  outgoing_shift_id: UuidSchema,
  incoming_shift_id: UuidSchema,
  summary: z.string(),
  open_incidents: z.array(UuidSchema),
  active_convoys: z.array(UuidSchema),
  priority_flags: z.string().nullable(),
  voice_note_id: UuidSchema.nullable(),
  acknowledged_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
});
export type ShiftHandover = z.infer<typeof ShiftHandoverSchema>;
