import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { verifyToken, signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { publishAudit } from '../lib/audit.js';
import { tokenRefreshCounter } from '../lib/metrics.js';
import { AuthError, ValidationError } from '../lib/errors.js';
import { createHash } from 'node:crypto';
import { config } from '../config.js';

const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});

interface TokenFamilyRow {
  id: string;
  user_id: string;
  org_id: string;
  last_refresh_token_hash: string;
  refresh_count: number;
  revoked_at: string | null;
}

interface UserRow {
  role: string;
}

export async function refreshRoutes(app: FastifyInstance): Promise<void> {
  app.post('/refresh', async (request, reply) => {
    const parsed = RefreshSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError('refresh_token is required');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { refresh_token } = parsed.data;
    const ip = request.ip;
    const ua = request.headers['user-agent'] ?? '';

    let payload;
    try {
      payload = await verifyToken(refresh_token);
    } catch {
      tokenRefreshCounter.inc({ result: 'invalid_token' });
      const err = new AuthError('Invalid or expired refresh token');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    if (payload['type'] !== 'refresh') {
      tokenRefreshCounter.inc({ result: 'wrong_type' });
      const err = new AuthError('Not a refresh token');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const familyId = typeof payload['fid'] === 'string' ? payload['fid'] : null;
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    const orgId = typeof payload['org_id'] === 'string' ? payload['org_id'] : null;

    if (!familyId || !userId || !orgId) {
      const err = new AuthError('Token missing required claims');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const incomingHash = createHash('sha256').update(refresh_token).digest('hex');

    // Atomic rotation: lock the family row, verify hash, issue new tokens, update hash — all in one transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const familyResult = await client.query<TokenFamilyRow>(
        `SELECT id, user_id, org_id, last_refresh_token_hash, refresh_count, revoked_at
         FROM token_families WHERE id = $1 FOR UPDATE`,
        [familyId],
      );
      const family = familyResult.rows[0];

      if (!family) {
        await client.query('ROLLBACK');
        tokenRefreshCounter.inc({ result: 'family_not_found' });
        const err = new AuthError('Token family not found');
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }

      if (family.revoked_at) {
        await client.query('ROLLBACK');
        tokenRefreshCounter.inc({ result: 'revoked' });
        const err = new AuthError('Token family has been revoked');
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }

      if (incomingHash !== family.last_refresh_token_hash) {
        // Token reuse detected — revoke entire family inside the same transaction.
        await client.query(
          `UPDATE token_families SET revoked_at = NOW() WHERE id = $1`,
          [familyId],
        );
        await client.query('COMMIT');
        tokenRefreshCounter.inc({ result: 'reuse_detected' });
        await publishAudit({
          action: 'auth.token.reuse_detected',
          actorType: 'system',
          actorId: userId,
          orgId,
          resourceType: 'token_family',
          resourceId: familyId,
          ipAddress: ip,
          userAgent: ua,
        }).catch(() => undefined);
        const err = new AuthError('Refresh token reuse detected — all sessions revoked');
        return reply.status(err.statusCode).send({ code: 'TOKEN_REUSE', message: err.message });
      }

      const users = await query<UserRow>(
        `SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId],
      );
      const role = users[0]?.role ?? 'operator';

      const newAccessToken = await signAccessToken({ sub: userId, org_id: orgId, role });
      const newRefreshToken = await signRefreshToken(familyId, userId, orgId);
      const newRefreshHash = createHash('sha256').update(newRefreshToken).digest('hex');

      await client.query(
        `UPDATE token_families
         SET last_refresh_token_hash = $1, refresh_count = refresh_count + 1, updated_at = NOW()
         WHERE id = $2`,
        [newRefreshHash, familyId],
      );

      await client.query('COMMIT');

      tokenRefreshCounter.inc({ result: 'success' });
      await publishAudit({
        action: 'auth.token.refreshed',
        actorType: 'user',
        actorId: userId,
        orgId,
        resourceType: 'token_family',
        resourceId: familyId,
        ipAddress: ip,
        userAgent: ua,
      }).catch(() => undefined);

      return reply.status(200).send({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: config.JWT_ACCESS_TTL_S,
        token_type: 'Bearer',
        family_id: familyId,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
