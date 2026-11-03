import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export const ApiKeyScopeSchema = z
  .string()
  .regex(
    /^[a-z_]+:(read|write|admin)$/,
    'Scope must be in the form resource:read|write|admin',
  );
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

// ---------------------------------------------------------------------------
// ApiKey
// ---------------------------------------------------------------------------

export const ApiKeySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  name: z.string().min(1).max(128),
  key_prefix: z
    .string()
    .length(8)
    .describe('First 8 characters of the raw key — safe for display'),
  key_hash: z.string().describe('Argon2id hash of the full raw key'),
  scopes: z.array(ApiKeyScopeSchema).min(1),
  ip_allowlist: z
    .array(z.string().ip({ version: 'v4' }).or(z.string().ip({ version: 'v6' })))
    .nullable()
    .describe('If null, any IP is allowed'),
  expires_at: IsoDateTimeSchema.nullable(),
  last_used_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
  revoked_at: IsoDateTimeSchema.nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

// ---------------------------------------------------------------------------
// Public projection (no key_hash)
// ---------------------------------------------------------------------------

export const ApiKeyPublicSchema = ApiKeySchema.omit({ key_hash: true });
export type ApiKeyPublic = z.infer<typeof ApiKeyPublicSchema>;

// ---------------------------------------------------------------------------
// Create response — only time the raw key is exposed
// ---------------------------------------------------------------------------

export const ApiKeyCreateResponseSchema = z.object({
  api_key: ApiKeyPublicSchema,
  raw_key: z.string().min(1).describe('Full raw key — show once, never stored'),
});
export type ApiKeyCreateResponse = z.infer<typeof ApiKeyCreateResponseSchema>;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const CreateApiKeyInputSchema = z.object({
  org_id: UuidSchema,
  name: z.string().min(1).max(128),
  scopes: z.array(ApiKeyScopeSchema).min(1),
  ip_allowlist: z
    .array(z.string())
    .nullable()
    .optional(),
  expires_at: IsoDateTimeSchema.nullable().optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;
