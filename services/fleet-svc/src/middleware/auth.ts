import { jwtVerify, createRemoteJWKSet, importSPKI, type JWTPayload } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { AuthError } from '../lib/errors.js';
import { tenantContext, query } from '../db.js';

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

  // Dev fallback: read PEM from env only.
  const pemEnv = process.env['AUTH_PUBLIC_KEY_PEM'];
  if (pemEnv) {
    if (!cachedPublicKey) {
      cachedPublicKey = await importSPKI(pemEnv, 'RS256');
    }
    return cachedPublicKey;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new AuthError('AUTH_JWKS_URI or AUTH_PUBLIC_KEY_PEM is required in production');
  }
  throw new AuthError('Authentication verification key is not configured');
}

async function verifyBearer(token: string): Promise<JWTPayload> {
  const key = await getVerificationKey();
  const { payload } = await jwtVerify(token, key as Parameters<typeof jwtVerify>[1], {
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    algorithms: ['RS256'],
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
    const role = typeof payload['role'] === 'string' ? payload['role'] : '';

    if (!sub || !orgId || !role) {
      throw new AuthError('Token missing required claims');
    }

    const live = (await query<{ id: string; org_id: string; role: string; status: string }>(
      'SELECT id, org_id, role, status FROM users WHERE id = $1 AND deleted_at IS NULL',
      [sub],
    ))[0];
    if (!live || live.status !== 'active' || live.org_id !== orgId) {
      throw new AuthError('Token tenant/session is no longer active');
    }

    request.user = { sub, org_id: live.org_id, role: live.role };
    tenantContext.enterWith(live.org_id);
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
