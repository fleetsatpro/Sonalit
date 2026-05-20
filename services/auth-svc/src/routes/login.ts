import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { verifyPassword } from '../lib/password.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { publishAudit } from '../lib/audit.js';
import { loginCounter } from '../lib/metrics.js';
import { AuthError, ValidationError } from '../lib/errors.js';
import { randomUUID, createHash } from 'node:crypto';
import { redis } from '../redis.js';
import * as OTPAuth from 'otpauth';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp_code: z.string().length(6).optional(),
});

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string | null;
  totp_enabled: boolean;
  totp_secret_enc: string | null;
}

interface FamilyRow {
  id: string;
}

export async function loginRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { email, password, totp_code } = parsed.data;
    const ip = request.ip;
    const ua = request.headers['user-agent'] ?? '';

    const users = await query<UserRow>(
      `SELECT id, org_id, email, name, role, password_hash, totp_enabled, totp_secret_enc
       FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email],
    );

    const user = users[0];

    // Constant-time path: always check even if user not found to prevent timing attacks
    const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummy';
    const hash = user?.password_hash ?? dummyHash;
    const passwordMatch = user ? await verifyPassword(hash, password) : false;

    if (!user || !passwordMatch) {
      loginCounter.inc({ result: 'failure' });
      await publishAudit({
        action: 'auth.login.failed',
        actorType: 'system',
        actorId: 'anonymous',
        orgId: null,
        resourceType: 'user',
        resourceId: email,
        ipAddress: ip,
        userAgent: ua,
      }).catch(() => undefined);
      const err = new AuthError('Invalid email or password');
      return reply.status(err.statusCode).send({ code: 'INVALID_CREDENTIALS', message: err.message });
    }

    // TOTP check
    if (user.totp_enabled) {
      if (!totp_code) {
        // Issue temp token for TOTP step
        const tempToken = randomUUID();
        await redis.set(`totp_challenge:${tempToken}`, user.id, 'EX', 300);
        return reply.status(200).send({ requires_totp: true, temp_token: tempToken });
      }

      if (!user.totp_secret_enc) {
        const err = new AuthError('TOTP misconfigured');
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }

      const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.totp_secret_enc) });
      const delta = totp.validate({ token: totp_code, window: 1 });
      if (delta === null) {
        loginCounter.inc({ result: 'totp_failure' });
        const err = new AuthError('Invalid TOTP code');
        return reply.status(err.statusCode).send({ code: 'INVALID_TOTP', message: err.message });
      }
    }

    // Issue tokens
    const familyId = randomUUID();
    const accessToken = await signAccessToken({
      sub: user.id,
      org_id: user.org_id,
      role: user.role,
    });
    const refreshToken = await signRefreshToken(familyId, user.id, user.org_id);
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');

    await query(
      `INSERT INTO token_families (id, user_id, org_id, last_refresh_token_hash)
       VALUES ($1, $2, $3, $4)`,
      [familyId, user.id, user.org_id, refreshHash],
    );

    loginCounter.inc({ result: 'success' });
    await publishAudit({
      action: 'auth.login.success',
      actorType: 'user',
      actorId: user.id,
      orgId: user.org_id,
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: ip,
      userAgent: ua,
    }).catch(() => undefined);

    return reply.status(200).send({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 300,
      token_type: 'Bearer',
      family_id: familyId,
    });
  });
}
