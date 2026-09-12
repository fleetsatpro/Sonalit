import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ClaimStatusSchema = z.enum([
  'draft', 'submitted', 'under_review', 'approved', 'rejected', 'settled',
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

// ---------------------------------------------------------------------------
// Insurance Claim
// ---------------------------------------------------------------------------

export const InsuranceClaimSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  incident_id: UuidSchema,
  convoy_id: UuidSchema.nullable(),
  vehicle_id: UuidSchema.nullable(),
  status: ClaimStatusSchema,
  claim_number: z.string().nullable(),
  insurer_name: z.string().nullable(),
  policy_number: z.string().nullable(),
  estimated_loss: z.number().nullable(),
  settled_amount: z.number().nullable(),
  currency: z.string().length(3).default('USD'),
  pdf_url: z.string().url().nullable(),
  submitted_at: IsoDateTimeSchema.nullable(),
  settled_at: IsoDateTimeSchema.nullable(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
});
export type InsuranceClaim = z.infer<typeof InsuranceClaimSchema>;
