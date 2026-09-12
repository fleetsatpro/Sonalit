import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// Voice Note
// ---------------------------------------------------------------------------

export const VoiceNoteParentTypeSchema = z.enum([
  'incident', 'field_report', 'message', 'handover',
]);
export type VoiceNoteParentType = z.infer<typeof VoiceNoteParentTypeSchema>;

export const VoiceNoteSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  uploader_id: UuidSchema,
  parent_type: VoiceNoteParentTypeSchema,
  parent_id: UuidSchema,
  file_url: z.string().url(),
  duration_s: z.number().int().min(1).max(60),
  transcript: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});
export type VoiceNote = z.infer<typeof VoiceNoteSchema>;
