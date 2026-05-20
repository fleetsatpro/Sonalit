import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as OTPAuth from 'otpauth';
import { query } from '../db.js';
import { verifyPassword } from '../lib/password.js';
import { requireAuth } from '../middleware/auth.js';
import { publishAudit } from '../lib/audit.js';
import { redis } from '../redis.js';
import { ValidationError, AuthError, NotFoundError } from '../lib/errors.js';

const VerifyTotpSetupSchema = z.object({
  totp_code: z.string().length(6),
});

const DisableTotpSchema = z.object({
  totp_code: z.string().length(6),
  password: z.string().min(1),
});

const TotpLoginSchema = z.object({
  temp_token: z.string().uuid(),
  totp_code: z.string().length(6),
});

interface UserRow {
  id: string;
  org_id: string;
  role: string;
  totp_enabled: boolean;
  totp_secret_enc: string | null;
  password_hash: string | null;
}

export async function totpRoutes(app: FastifyInstance): Promise<void> {
  // Begin TOTP setup — generate secret and otpauth URI
  app.post('/totp/setup/begin', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;

    const users = await query<UserRow>(
      `SELECT id, org_id, role, totp_enabled, totp_secret_enc FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [authUser.sub],
    );
    const user = users[0];
    if (!user) {
      const err = new NotFoundError('User');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    if (user.totp_enabled) {
      return reply.status(409).send({ code: 'TOTP_ALREADY_ENABLED', message: 'TOTP is already enabled' });
    }

    const secret = new OTPAuth.Secret();
    const totp = new OTPAuth.TOTP({
      issuer: 'Sonalit',
      label: authUser.sub,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const uri = totp.toString();
    const secretBase32 = secret.base32;

    // Store pending secret in Redis (not DB) until verified
    await redis.set(`totp_pending:${authUser.sub}`, secretBase32, 'EX', 600);

    return reply.status(200).send({
      otpauth_uri: uri,
      secret: secretBase32,
    });
  });

  // Verify TOTP code and enable TOTP
  app.post('/totp/setup/verify', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;

    const parsed = VerifyTotpSetupSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError('totp_code must be 6 digits');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const pendingSecret = await redis.get(`totp_pending:${authUser.sub}`);
    if (!pendingSecret) {
      return reply.status(400).send({ code: 'NO_PENDING_SETUP', message: 'No pending TOTP setup found. Call /totp/setup/begin first.' });
    }

    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(pendingSecret) });
    const delta = totp.validate({ token: parsed.data.totp_code, window: 1 });
    if (delta === null) {
      const err = new ValidationError('Invalid TOTP code');
      return reply.status(err.statusCode).send({ code: 'INVALID_TOTP', message: err.message });
    }

    // Store secret and enable TOTP
    await query(
      `UPDATE users SET totp_enabled = TRUE, totp_secret_enc = $1, updated_at = NOW() WHERE id = $2`,
      [pendingSecret, authUser.sub],
    );
    await redis.del(`totp_pending:${authUser.sub}`);

    await publishAudit({
      action: 'auth.totp.enabled',
      actorType: 'user',
      actorId: authUser.sub,
      orgId: authUser.org_id,
      resourceType: 'user',
      resourceId: authUser.sub,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    }).catch(() => undefined);

    return reply.status(200).send({ ok: true });
  });

  // Disable TOTP
  app.post('/totp/disable', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;

    const parsed = DisableTotpSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const users = await query<UserRow>(
      `SELECT id, org_id, role, totp_enabled, totp_secret_enc, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [authUser.sub],
    );
    const user = users[0];
    if (!user) {
      const err = new NotFoundError('User');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    if (!user.totp_enabled || !user.totp_secret_enc) {
      return reply.status(409).send({ code: 'TOTP_NOT_ENABLED', message: 'TOTP is not enabled' });
    }

    if (!user.password_hash) {
      return reply.status(400).send({ code: 'NO_PASSWORD', message: 'Account has no password — cannot verify identity' });
    }

    const passwordOk = await verifyPassword(user.password_hash, parsed.data.password);
    if (!passwordOk) {
      return reply.status(401).send({ code: 'INVALID_CREDENTIALS', message: 'Invalid password' });
    }

    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totp_secret_enc) });
    const delta = totp.validate({ token: parsed.data.totp_code, window: 1 });
    if (delta === null) {
      return reply.status(401).send({ code: 'INVALID_TOTP', message: 'Invalid TOTP code' });
    }

    await query(
      `UPDATE users SET totp_enabled = FALSE, totp_secret_enc = NULL, updated_at = NOW() WHERE id = $1`,
      [authUser.sub],
    );

    await publishAudit({
      action: 'auth.totp.disabled',
      actorType: 'user',
      actorId: authUser.sub,
      orgId: authUser.org_id,
      resourceType: 'user',
      resourceId: authUser.sub,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    }).catch(() => undefined);

    return reply.status(200).send({ ok: true });
  });

  // Complete TOTP login step (when requires_totp was returned)
  app.post('/totp/verify-login', async (request, reply) => {
    const parsed = TotpLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const userId = await redis.get(`totp_challenge:${parsed.data.temp_token}`);
    if (!userId) {
      return reply.status(401).send({ code: 'CHALLENGE_EXPIRED', message: 'TOTP challenge expired or invalid' });
    }

    const users = await query<UserRow>(
      `SELECT id, org_id, role, totp_enabled, totp_secret_enc FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId],
    );
    const user = users[0];
    if (!user || !user.totp_enabled || !user.totp_secret_enc) {
      const err = new AuthError('TOTP not configured');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totp_secret_enc) });
    const delta = totp.validate({ token: parsed.data.totp_code, window: 1 });
    if (delta === null) {
      return reply.status(401).send({ code: 'INVALID_TOTP', message: 'Invalid TOTP code' });
    }

    await redis.del(`totp_challenge:${parsed.data.temp_token}`);

    const { signAccessToken, signRefreshToken } = await import('../lib/jwt.js');
    const { randomUUID, createHash } = await import('node:crypto');
    const familyId = randomUUID();
    const accessToken = await signAccessToken({ sub: user.id, org_id: user.org_id, role: user.role });
    const refreshToken = await signRefreshToken(familyId, user.id, user.org_id);
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');

    await query(
      `INSERT INTO token_families (id, user_id, org_id, last_refresh_token_hash)
       VALUES ($1, $2, $3, $4)`,
      [familyId, user.id, user.org_id, refreshHash],
    );

    return reply.status(200).send({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 300,
      token_type: 'Bearer',
      family_id: familyId,
    });
  });
}
