import { jwtVerify, createRemoteJWKSet, importSPKI, type JWTPayload } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { AuthError } from '../lib/errors.js';
import { tenantContext } from '../db.js';

export interface RequestUser { sub: string; org_id: string; role: string; }
declare module 'fastify' { interface FastifyRequest { user?: RequestUser; } }

const AUTH_JWKS_URI = process.env['AUTH_JWKS_URI'];
let cachedPublicKey: Awaited<ReturnType<typeof importSPKI>> | null = null;

async function getVerificationKey(): Promise<ReturnType<typeof createRemoteJWKSet> | Awaited<ReturnType<typeof importSPKI>>> {
  if (AUTH_JWKS_URI) return createRemoteJWKSet(new URL(AUTH_JWKS_URI));
  const pemEnv = process.env['AUTH_PUBLIC_KEY_PEM'];
  if (!pemEnv) throw new AuthError('AUTH_JWKS_URI or AUTH_PUBLIC_KEY_PEM is required');
  if (!cachedPublicKey) cachedPublicKey = await importSPKI(pemEnv, 'RS256');
  return cachedPublicKey;
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

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header');
  }
  try {
    const payload = await verifyBearer(header.slice(7));
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
