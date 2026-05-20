import { z } from 'zod';
import { UuidSchema, SoftDeleteSchema } from './common.js';

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const OrgPlanSchema = z.enum(['free', 'pro', 'enterprise']);
export type OrgPlan = z.infer<typeof OrgPlanSchema>;

// ---------------------------------------------------------------------------
// OIDC config (optional per-org SSO)
// ---------------------------------------------------------------------------

export const OidcConfigSchema = z.object({
  issuer: z.string().url(),
  client_id: z.string().min(1),
  client_secret_ref: z
    .string()
    .min(1)
    .describe('Reference to secret manager key, not the raw secret'),
  scopes: z.array(z.string()).min(1),
  pkce_required: z.boolean(),
});
export type OidcConfig = z.infer<typeof OidcConfigSchema>;

// ---------------------------------------------------------------------------
// Org
// ---------------------------------------------------------------------------

export const OrgSchema = SoftDeleteSchema.extend({
  id: UuidSchema,
  name: z.string().min(1).max(256),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  plan: OrgPlanSchema,
  oidc_config: OidcConfigSchema.nullable(),
});
export type Org = z.infer<typeof OrgSchema>;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CreateOrgInputSchema = z.object({
  name: z.string().min(1).max(256),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  plan: OrgPlanSchema,
  oidc_config: OidcConfigSchema.nullable().optional(),
});
export type CreateOrgInput = z.infer<typeof CreateOrgInputSchema>;

export const UpdateOrgInputSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  plan: OrgPlanSchema.optional(),
  oidc_config: OidcConfigSchema.nullable().optional(),
}).refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update' },
);
export type UpdateOrgInput = z.infer<typeof UpdateOrgInputSchema>;
