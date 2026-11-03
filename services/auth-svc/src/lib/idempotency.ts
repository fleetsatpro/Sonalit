import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../redis.js';

const TTL_SECONDS = 86_400;
const PENDING_SENTINEL = '__pending__';

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

function redisKeyFor(key: string, method: string, url: string): string {
  return `idem:${createHash('sha256').update(`${key}:${method}:${url}`).digest('hex')}`;
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

  const redisKey = redisKeyFor(key, request.method, request.url);

  // Atomically reserve the key with a pending sentinel.
  // SET NX EX returns 'OK' if key was newly set, null if it already existed.
  const pendingRecord: IdempotencyRecord = { bodyHash, status: 0, body: PENDING_SENTINEL };
  const acquired = await redis.set(
    redisKey,
    JSON.stringify(pendingRecord),
    'EX', TTL_SECONDS,
    'NX',
  );

  if (acquired === null) {
    // Key already exists — another request has this key.
    const raw = await redis.get(redisKey);
    if (!raw) {
      // Expired between SET NX check and GET — let this request through.
      request.idempotencyKey = redisKey;
      request.idempotencyBodyHash = bodyHash;
      return;
    }
    const parsed = JSON.parse(raw) as IdempotencyRecord;
    if (parsed.bodyHash !== bodyHash) {
      await reply.status(409).send({
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Same Idempotency-Key used with a different request body',
      });
      return;
    }
    if (parsed.body === PENDING_SENTINEL) {
      // Request is still in-flight — ask client to retry.
      reply.raw.setHeader('Retry-After', '5');
      await reply.status(503).send({
        code: 'PROCESSING',
        message: 'An identical request is currently being processed. Retry after 5 seconds.',
      });
      return;
    }
    // Completed response cached — replay it.
    await reply.status(parsed.status).send(parsed.body);
    return;
  }

  // We atomically acquired the key. Proceed with the request.
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
