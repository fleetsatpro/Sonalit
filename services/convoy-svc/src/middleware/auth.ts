import { jwtVerify, createRemoteJWKSet, importSPKI, type JWTPayload } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query, tenantContext } from '../db.js';

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

const issuer = process.env.JWT_ISSUER || 'https://auth.sonalit.io';
const audience = process.env.JWT_AUDIENCE || 'sonalit-v4';
const jwksUri = process.env.AUTH_JWKS_URI;
let cachedPublicKey: Awaited<ReturnType<typeof importSPKI>> | null = null;

async function getKey() {
  if (jwksUri) return createRemoteJWKSet(new URL(jwksUri));
  const pem = process.env.AUTH_PUBLIC_KEY_PEM;
  if (!pem) throw new Error('AUTH_JWKS_URI or AUTH_PUBLIC_KEY_PEM is required');
  if (!cachedPublicKey) cachedPublicKey = await importSPKI(pem, 'RS256');
  return cachedPublicKey;
}

async function verify(token: string): Promise<JWTPayload> {
  const key = await getKey();
  return (await jwtVerify(token, key as Parameters<typeof jwtVerify>[1], {
    issuer,
    audience,
    algorithms: ['RS256'],
  })).payload;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Missing or malformed Authorization header' });
    return;
  }

  try {
    const payload = await verify(header.slice(7));
    if (payload.type !== 'access') throw new Error('invalid token type');

    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const claimedOrgId = typeof payload.org_id === 'string' ? payload.org_id : null;
    if (!sub || !claimedOrgId) throw new Error('missing required claims');

    // The verified JWT tenant is trusted only as the selector for this
    // pre-auth RLS lookup; the live users row must still match it exactly.
    tenantContext.enterWith(claimedOrgId);

    // JWT identity is necessary but not sufficient: org and role remain
    // authoritative in the current users row so a stale token cannot retain
    // access to a tenant or role after an administrative change.
    const live = (await query<{ id: string; org_id: string; role: string; status: string }>(
      'SELECT id, org_id, role, status FROM users WHERE id = $1 AND deleted_at IS NULL',
      [sub],
    ))[0];

    if (!live || live.status !== 'active' || live.org_id !== claimedOrgId) {
      throw new Error('token tenant/session is no longer active');
    }

    req.user = { sub, org_id: live.org_id, role: live.role };
    tenantContext.enterWith(live.org_id);
  } catch {
    await reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Token invalid, expired, or no longer active' });
  }
}

export function requireRole(...roles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = req.user;
    if (!user) {
      await reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Authentication required' });
      return;
    }
    if (!roles.includes(user.role)) {
      await reply.code(403).send({ code: 'FORBIDDEN', message: 'Required role is not permitted' });
    }
  };
}
