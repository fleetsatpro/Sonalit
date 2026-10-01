import { jwtVerify, createRemoteJWKSet, importSPKI, type JWTPayload } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthError } from '../lib/errors.js';
import { tenantContext } from '../db.js';

export interface RequestUser { sub: string; org_id: string; role: string; }
declare module 'fastify' { interface FastifyRequest { user?: RequestUser; } }

const issuer = process.env['JWT_ISSUER'] ?? 'https://auth.sonalit.io';
const audience = process.env['JWT_AUDIENCE'] ?? 'sonalit-v4';
const jwksUri = process.env['AUTH_JWKS_URI'];
let cachedPublicKey: Awaited<ReturnType<typeof importSPKI>> | null = null;

async function key() {
  if (jwksUri) return createRemoteJWKSet(new URL(jwksUri));
  const pem = process.env['AUTH_PUBLIC_KEY_PEM'];
  if (!pem) throw new AuthError('AUTH_JWKS_URI or AUTH_PUBLIC_KEY_PEM is required');
  if (!cachedPublicKey) cachedPublicKey = await importSPKI(pem, 'RS256');
  return cachedPublicKey;
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AuthError('Missing or malformed Authorization header');
  try {
    const { payload }: { payload: JWTPayload } = await jwtVerify(
      header.slice(7), await key() as Parameters<typeof jwtVerify>[1],
      { issuer, audience, algorithms: ['RS256'] },
    );
    if (payload.type !== 'access') throw new AuthError('Invalid token type');
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const org_id = typeof payload.org_id === 'string' ? payload.org_id : '';
    const role = typeof payload.role === 'string' ? payload.role : '';
    if (!sub || !org_id || !role) throw new AuthError('Token missing required claims');
    request.user = { sub, org_id, role };
    tenantContext.enterWith(org_id);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Token invalid or expired');
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) throw new AuthError();
    if (!roles.includes(request.user.role)) {
      const err = new Error('Role not permitted') as Error & { statusCode?: number; code?: string };
      err.statusCode = 403; err.code = 'FORBIDDEN'; throw err;
    }
  };
}
