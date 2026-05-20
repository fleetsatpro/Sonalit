import type { FastifyInstance } from 'fastify';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationInfo,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { query } from '../db.js';
import { redis } from '../redis.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { publishAudit } from '../lib/audit.js';
import { loginCounter } from '../lib/metrics.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { ValidationError, NotFoundError, AuthError } from '../lib/errors.js';
import { randomUUID, createHash } from 'node:crypto';

const VerifyRegistrationSchema = z.object({
  registration_response: z.record(z.string(), z.unknown()),
});

const AuthRequestSchema = z.object({
  credential_id: z.string().optional(),
});

const VerifyAuthSchema = z.object({
  authentication_response: z.record(z.string(), z.unknown()),
  user_email: z.string().email().optional(),
});

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: number;
  transports: string[] | null;
}

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: string;
}

export async function passkeyRoutes(app: FastifyInstance): Promise<void> {
  // Generate registration options
  app.post('/passkeys/register/begin', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;
    const users = await query<UserRow>(
      `SELECT id, org_id, email, name FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [authUser.sub],
    );
    const user = users[0];
    if (!user) {
      const err = new NotFoundError('User');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const existingPasskeys = await query<{ credential_id: string; transports: string[] | null }>(
      `SELECT credential_id, transports FROM user_passkeys WHERE user_id = $1`,
      [user.id],
    );

    const options = await generateRegistrationOptions({
      rpName: config.WEBAUTHN_RP_NAME,
      rpID: config.WEBAUTHN_RP_ID,
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credential_id,
        transports: (pk.transports ?? []) as Parameters<typeof generateRegistrationOptions>[0]['excludeCredentials'][0]['transports'],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await redis.set(
      `webauthn_reg:${authUser.sub}`,
      JSON.stringify(options.challenge),
      'EX',
      300,
    );

    return reply.status(200).send(options);
  });

  // Complete registration
  app.post('/passkeys/register/complete', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;
    const parsed = VerifyRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError('Invalid registration response');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const challengeStr = await redis.get(`webauthn_reg:${authUser.sub}`);
    if (!challengeStr) {
      return reply.status(400).send({ code: 'CHALLENGE_EXPIRED', message: 'Registration challenge expired' });
    }

    let verification: VerifiedRegistrationInfo & { verified: boolean };
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data.registration_response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
        expectedChallenge: JSON.parse(challengeStr) as string,
        expectedOrigin: config.WEBAUTHN_ORIGIN,
        expectedRPID: config.WEBAUTHN_RP_ID,
      });
    } catch (err) {
      const ve = new ValidationError(`WebAuthn verification failed: ${(err as Error).message}`);
      return reply.status(ve.statusCode).send({ code: ve.code, message: ve.message });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return reply.status(400).send({ code: 'VERIFICATION_FAILED', message: 'Passkey registration verification failed' });
    }

    const { credential } = verification.registrationInfo;
    await redis.del(`webauthn_reg:${authUser.sub}`);

    await query(
      `INSERT INTO user_passkeys (id, user_id, credential_id, public_key, counter, transports)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (credential_id) DO NOTHING`,
      [
        randomUUID(),
        authUser.sub,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.transports ?? null,
      ],
    );

    await publishAudit({
      action: 'auth.passkey.registered',
      actorType: 'user',
      actorId: authUser.sub,
      orgId: authUser.org_id,
      resourceType: 'passkey',
      resourceId: credential.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    }).catch(() => undefined);

    return reply.status(200).send({ ok: true });
  });

  // Generate authentication options
  app.post('/passkeys/authenticate/begin', async (request, reply) => {
    const parsed = AuthRequestSchema.safeParse(request.body);
    const credentialId = parsed.success ? parsed.data.credential_id : undefined;

    const allowCredentials = credentialId
      ? [{ id: credentialId }]
      : [];

    const options = await generateAuthenticationOptions({
      rpID: config.WEBAUTHN_RP_ID,
      userVerification: 'preferred',
      allowCredentials,
    });

    await redis.set(
      `webauthn_auth:${options.challenge}`,
      JSON.stringify(options.challenge),
      'EX',
      300,
    );

    return reply.status(200).send(options);
  });

  // Complete authentication
  app.post('/passkeys/authenticate/complete', async (request, reply) => {
    const parsed = VerifyAuthSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError('Invalid authentication response');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const authResp = parsed.data.authentication_response;
    const credentialId = typeof authResp['id'] === 'string' ? authResp['id'] : '';

    const passkeys = await query<PasskeyRow>(
      `SELECT id, user_id, credential_id, public_key, counter, transports
       FROM user_passkeys WHERE credential_id = $1 LIMIT 1`,
      [credentialId],
    );
    const passkey = passkeys[0];
    if (!passkey) {
      const err = new NotFoundError('Passkey');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const challengeKey = `webauthn_auth:${typeof authResp['response'] === 'object' && authResp['response'] !== null ? '' : ''}`;
    // Find challenge by iterating possible stored challenges
    const rawChallenge = typeof authResp['challenge'] === 'string' ? authResp['challenge'] : '';
    const storedChallenge = await redis.get(`webauthn_auth:${rawChallenge}`);

    if (!storedChallenge) {
      return reply.status(400).send({ code: 'CHALLENGE_EXPIRED', message: 'Authentication challenge expired or not found' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: authResp as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge: JSON.parse(storedChallenge) as string,
        expectedOrigin: config.WEBAUTHN_ORIGIN,
        expectedRPID: config.WEBAUTHN_RP_ID,
        credential: {
          id: passkey.credential_id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: passkey.counter,
          transports: (passkey.transports ?? []) as Parameters<typeof verifyAuthenticationResponse>[0]['credential']['transports'],
        },
      });
    } catch (err) {
      loginCounter.inc({ result: 'passkey_failure' });
      const ve = new AuthError(`WebAuthn verification failed: ${(err as Error).message}`);
      return reply.status(ve.statusCode).send({ code: ve.code, message: ve.message });
    }

    if (!verification.verified) {
      loginCounter.inc({ result: 'passkey_failure' });
      return reply.status(401).send({ code: 'VERIFICATION_FAILED', message: 'Passkey authentication failed' });
    }

    await query(
      `UPDATE user_passkeys SET counter = $1 WHERE id = $2`,
      [verification.authenticationInfo.newCounter, passkey.id],
    );
    await redis.del(`webauthn_auth:${rawChallenge}`);

    const users = await query<UserRow>(
      `SELECT id, org_id, email, name, role FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [passkey.user_id],
    );
    const user = users[0];
    if (!user) {
      const err = new NotFoundError('User');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const familyId = randomUUID();
    const accessToken = await signAccessToken({ sub: user.id, org_id: user.org_id, role: user.role });
    const refreshToken = await signRefreshToken(familyId, user.id, user.org_id);
    const refreshHash = createHash('sha256').update(refreshToken).digest('hex');

    await query(
      `INSERT INTO token_families (id, user_id, org_id, last_refresh_token_hash)
       VALUES ($1, $2, $3, $4)`,
      [familyId, user.id, user.org_id, refreshHash],
    );

    loginCounter.inc({ result: 'passkey_success' });
    await publishAudit({
      action: 'auth.passkey.login',
      actorType: 'user',
      actorId: user.id,
      orgId: user.org_id,
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    }).catch(() => undefined);

    return reply.status(200).send({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 300,
      token_type: 'Bearer',
      family_id: familyId,
    });
  });

  // List passkeys
  app.get('/passkeys', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;
    const passkeys = await query<{ id: string; credential_id: string; transports: string[] | null; created_at: string }>(
      `SELECT id, credential_id, transports, created_at FROM user_passkeys WHERE user_id = $1 ORDER BY created_at DESC`,
      [authUser.sub],
    );
    return reply.status(200).send({ passkeys });
  });

  // Remove passkey
  app.delete('/passkeys/:id', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;
    const { id } = request.params as { id: string };
    await query(
      `DELETE FROM user_passkeys WHERE id = $1 AND user_id = $2`,
      [id, authUser.sub],
    );
    await publishAudit({
      action: 'auth.passkey.removed',
      actorType: 'user',
      actorId: authUser.sub,
      orgId: authUser.org_id,
      resourceType: 'passkey',
      resourceId: id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    }).catch(() => undefined);
    return reply.status(200).send({ ok: true });
  });
}
