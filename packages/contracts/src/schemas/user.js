import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema, SoftDeleteSchema } from './common.js';
// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------
export const UserRoleSchema = z.enum([
    'super_admin',
    'org_admin',
    'operator',
    'viewer',
    'cfo',
    'driver',
]);
// ---------------------------------------------------------------------------
// Passkey credential (WebAuthn)
// ---------------------------------------------------------------------------
export const PasskeyCredentialSchema = z.object({
    credential_id: z.string(),
    public_key_cose: z.string().describe('Base64url-encoded COSE public key'),
    sign_count: z.number().int().nonnegative(),
    transports: z.array(z.string()).optional(),
    created_at: IsoDateTimeSchema,
    last_used_at: IsoDateTimeSchema.nullable(),
});
// ---------------------------------------------------------------------------
// User (full, internal)
// ---------------------------------------------------------------------------
export const UserSchema = SoftDeleteSchema.extend({
    id: UuidSchema,
    org_id: UuidSchema,
    email: z.string().email(),
    name: z.string().min(1).max(256),
    role: UserRoleSchema,
    passkey_credentials: z.array(PasskeyCredentialSchema),
    totp_enabled: z.boolean(),
    oidc_sub: z.string().nullable(),
});
// ---------------------------------------------------------------------------
// UserPublic — safe to expose via API (no sensitive fields)
// ---------------------------------------------------------------------------
export const UserPublicSchema = UserSchema.omit({
    passkey_credentials: true,
    oidc_sub: true,
});
// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export const CreateUserInputSchema = z.object({
    org_id: UuidSchema,
    email: z.string().email(),
    name: z.string().min(1).max(256),
    role: UserRoleSchema,
    oidc_sub: z.string().nullable().optional(),
});
export const UpdateUserInputSchema = z.object({
    name: z.string().min(1).max(256).optional(),
    role: UserRoleSchema.optional(),
    totp_enabled: z.boolean().optional(),
    oidc_sub: z.string().nullable().optional(),
}).refine((obj) => Object.values(obj).some((v) => v !== undefined), { message: 'At least one field must be provided for update' });
