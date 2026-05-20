import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { query } from '../db.js';
import { hashPassword } from '../lib/password.js';
import { requireAuth } from '../middleware/auth.js';
import { publishAudit } from '../lib/audit.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { randomUUID } from 'node:crypto';

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function toBase62(bytes: Buffer): string {
  let num = BigInt(`0x${bytes.toString('hex')}`);
  let result = '';
  const base = BigInt(62);
  while (num > 0n) {
    result = BASE62_CHARS[Number(num % base)]! + result;
    num = num / base;
  }
  return result.padStart(43, '0'); // 32 bytes → ~43 base62 chars
}

function generateApiKey(): { raw: string; prefix: string } {
  const bytes = randomBytes(32);
  const b62 = toBase62(bytes);
  const raw = `sk_live_${b62}`;
  const prefix = raw.slice(0, 8);
  return { raw, prefix };
}

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.string().regex(/^[a-z_]+:(read|write|admin)$/)).min(1),
  ip_allowlist: z.array(z.string()).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

interface ApiKeyRow {
  id: string;
  org_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  ip_allowlist: string[] | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api-keys', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;
    const keys = await query<ApiKeyRow>(
      `SELECT id, org_id, name, key_prefix, scopes, ip_allowlist, expires_at, last_used_at, created_at, revoked_at
       FROM api_keys WHERE org_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [authUser.org_id],
    );
    return reply.status(200).send({ api_keys: keys });
  });

  app.post('/api-keys', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;

    const parsed = CreateApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { name, scopes, ip_allowlist, expires_at } = parsed.data;
    const { raw, prefix } = generateApiKey();
    const keyHash = await hashPassword(raw);
    const id = randomUUID();

    await query(
      `INSERT INTO api_keys (id, org_id, name, key_prefix, key_hash, scopes, ip_allowlist, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, authUser.org_id, name, prefix, keyHash, scopes, ip_allowlist ?? null, expires_at ?? null],
    );

    await publishAudit({
      action: 'auth.apikey.created',
      actorType: 'user',
      actorId: authUser.sub,
      orgId: authUser.org_id,
      resourceType: 'api_key',
      resourceId: id,
      afterState: { name, scopes, prefix },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    }).catch(() => undefined);

    const created = await query<ApiKeyRow>(
      `SELECT id, org_id, name, key_prefix, scopes, ip_allowlist, expires_at, last_used_at, created_at, revoked_at
       FROM api_keys WHERE id = $1 LIMIT 1`,
      [id],
    );

    return reply.status(201).send({
      api_key: created[0],
      raw_key: raw,
    });
  });

  app.delete('/api-keys/:id', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;
    const { id } = request.params as { id: string };

    const keys = await query<ApiKeyRow>(
      `SELECT id, org_id, name, key_prefix FROM api_keys WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL LIMIT 1`,
      [id, authUser.org_id],
    );
    if (keys.length === 0) {
      const err = new NotFoundError('API key');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    await query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND org_id = $2`,
      [id, authUser.org_id],
    );

    await publishAudit({
      action: 'auth.apikey.revoked',
      actorType: 'user',
      actorId: authUser.sub,
      orgId: authUser.org_id,
      resourceType: 'api_key',
      resourceId: id,
      beforeState: { prefix: keys[0]?.key_prefix },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    }).catch(() => undefined);

    return reply.status(200).send({ ok: true });
  });
}
