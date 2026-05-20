import { jwtVerify, createRemoteJWKSet, importSPKI, type JWTPayload } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { AuthError } from '../lib/errors.js';

export interface RequestUser {
  sub: string;
  org_id: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: RequestUser;
  }
}

// Dev-only symmetric fallback: accept RS256 via remote JWKS from auth-svc,
// or fall back to a locally-generated in-memory key when JWKS_URI is absent.
// In production AUTH_JWKS_URI must be set.
const AUTH_JWKS_URI = process.env['AUTH_JWKS_URI'];

let cachedPublicKey: Awaited<ReturnType<typeof importSPKI>> | null = null;

async function getVerificationKey(): Promise<
  ReturnType<typeof createRemoteJWKSet> | Awaited<ReturnType<typeof importSPKI>>
> {
  if (AUTH_JWKS_URI) {
    return createRemoteJWKSet(new URL(AUTH_JWKS_URI));
  }

  // Dev fallback: read PEM from env or generate ephemeral
  const pemEnv = process.env['AUTH_PUBLIC_KEY_PEM'];
  if (pemEnv) {
    if (!cachedPublicKey) {
      cachedPublicKey = await importSPKI(pemEnv, 'RS256');
    }
    return cachedPublicKey;
  }

  // Absolute last resort for local dev — generate a throwaway key.
  // Tokens will only verify if they were signed by the same process,
  // so this only works when auth-svc and fleet-svc share the generated key.
  const { generateKeyPair } = await import('node:crypto');
  const { privateKey: _pk, publicKey } = await new Promise<{
    privateKey: string;
    publicKey: string;
  }>((resolve, reject) => {
    generateKeyPair(
      'rsa',
      { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } },
      (err, pub, priv) => (err ? reject(err) : resolve({ privateKey: priv, publicKey: pub })),
    );
  });
  cachedPublicKey = await importSPKI(publicKey, 'RS256');
  return cachedPublicKey;
}

async function verifyBearer(token: string): Promise<JWTPayload> {
  const key = await getVerificationKey();
  const { payload } = await jwtVerify(token, key, {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
  });
  return payload;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    const err = new AuthError('Missing or malformed Authorization header');
    await reply.status(err.statusCode).send({ code: err.code, message: err.message });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyBearer(token);

    if (payload['type'] !== 'access') {
      throw new AuthError('Invalid token type');
    }

    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const orgId = typeof payload['org_id'] === 'string' ? payload['org_id'] : null;
    const role = typeof payload['role'] === 'string' ? payload['role'] : 'operator';

    if (!sub || !orgId) {
      throw new AuthError('Token missing required claims');
    }

    request.user = { sub, org_id: orgId, role };
  } catch (err) {
    if (err instanceof AuthError) {
      await reply.status(err.statusCode).send({ code: err.code, message: err.message });
      return;
    }
    const authErr = new AuthError('Token invalid or expired');
    await reply.status(authErr.statusCode).send({ code: authErr.code, message: authErr.message });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    if (!user) {
      const err = new AuthError();
      await reply.status(err.statusCode).send({ code: err.code, message: err.message });
      return;
    }
    if (!roles.includes(user.role)) {
      const { ForbiddenError } = await import('../lib/errors.js');
      const err = new ForbiddenError(`Role '${user.role}' is not permitted`);
      await reply.status(err.statusCode).send({ code: err.code, message: err.message });
      return;
    }
  };
}
