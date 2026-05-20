import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../lib/jwt.js';
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
    const payload = await verifyToken(token);

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
