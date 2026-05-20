import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../redis.js';

const TTL_SECONDS = 86_400;

interface IdempotencyRecord {
  bodyHash: string;
  status: number;
  body: unknown;
}

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
    idempotencyBodyHash?: string;
  }
}

export async function idempotencyHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = request.headers['idempotency-key'];
  if (!key || typeof key !== 'string') return;

  const bodyHash = createHash('sha256')
    .update(JSON.stringify(request.body ?? {}))
    .digest('hex');

  const redisKey = `idem:${createHash('sha256')
    .update(`${key}:${request.method}:${request.url}`)
    .digest('hex')}`;

  const existing = await redis.get(redisKey);
  if (existing) {
    const parsed = JSON.parse(existing) as IdempotencyRecord;
    if (parsed.bodyHash !== bodyHash) {
      await reply
        .status(409)
        .send({ code: 'IDEMPOTENCY_CONFLICT', message: 'Same key used with different request body' });
      return;
    }
    await reply.status(parsed.status).send(parsed.body);
    return;
  }

  request.idempotencyKey = redisKey;
  request.idempotencyBodyHash = bodyHash;
}

export async function storeIdempotencyResult(
  request: FastifyRequest,
  status: number,
  body: unknown,
): Promise<void> {
  if (!request.idempotencyKey) return;
  const record: IdempotencyRecord = {
    bodyHash: request.idempotencyBodyHash ?? '',
    status,
    body,
  };
  await redis.set(request.idempotencyKey, JSON.stringify(record), 'EX', TTL_SECONDS);
}
