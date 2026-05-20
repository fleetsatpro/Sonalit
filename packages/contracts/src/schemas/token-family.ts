import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ---------------------------------------------------------------------------
// TokenFamily
// Implements refresh token rotation with family-level revocation.
// When a reused token is detected, the entire family is revoked (Refresh Token
// Rotation / Family-Based Revocation strategy).
// ---------------------------------------------------------------------------

export const TokenFamilySchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  org_id: UuidSchema,
  created_at: IsoDateTimeSchema,
  revoked_at: IsoDateTimeSchema.nullable(),
  last_refresh_token_hash: z
    .string()
    .describe('Argon2id hash of the most recent refresh token issued for this family'),
  refresh_count: z
    .number()
    .int()
    .nonnegative()
    .describe('Number of times the refresh token has been rotated'),
});
export type TokenFamily = z.infer<typeof TokenFamilySchema>;

// ---------------------------------------------------------------------------
// Token pair issued on login or refresh
// ---------------------------------------------------------------------------

export const TokenPairSchema = z.object({
  access_token: z.string().min(1).describe('Short-lived JWT (15 min)'),
  refresh_token: z.string().min(1).describe('Long-lived opaque token (30 days)'),
  expires_in: z.number().int().positive().describe('Access token TTL in seconds'),
  token_type: z.literal('Bearer'),
  family_id: UuidSchema,
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

// ---------------------------------------------------------------------------
// Refresh request
// ---------------------------------------------------------------------------

export const RefreshTokenRequestSchema = z.object({
  refresh_token: z.string().min(1),
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

export const RevokeTokenFamilyInputSchema = z.object({
  family_id: UuidSchema,
  reason: z
    .enum(['logout', 'token_reuse', 'admin_revoke', 'security_incident'])
    .describe('Reason for revocation, used in audit log'),
});
export type RevokeTokenFamilyInput = z.infer<typeof RevokeTokenFamilyInputSchema>;
