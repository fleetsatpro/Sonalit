import { jwtVerify, createRemoteJWKSet, importSPKI, type JWTPayload } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { tenantContext } from '../db.js';

export interface RequestUser { sub: string; org_id: string; role: string; }
declare module 'fastify' { interface FastifyRequest { user?: RequestUser; } }

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

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    await reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Missing or malformed Authorization header' });
    return;
  }
  try {
    const key = await getKey();
    const payload: JWTPayload = (await jwtVerify(header.slice(7), key as Parameters<typeof jwtVerify>[1], {
      issuer, audience, algorithms: ['RS256'],
    })).payload;
    if (payload.type !== 'access') throw new Error('invalid token type');
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const org_id = typeof payload.org_id === 'string' ? payload.org_id : null;
    const role = typeof payload.role === 'string' ? payload.role : null;
    if (!sub || !org_id || !role) throw new Error('missing required claims');
    tenantContext.enterWith(org_id);
    req.user = { sub, org_id, role };
  } catch {
    await reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'Token invalid or expired' });
  }
}
