import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';
import { hashPassword, isPasswordPwned } from '../lib/password.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { publishAudit } from '../lib/audit.js';
import { registerCounter } from '../lib/metrics.js';
import { ConflictError, ValidationError } from '../lib/errors.js';
import { randomUUID, createHash } from 'node:crypto';

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(256),
  password: z.string().min(12).max(128),
  org_name: z.string().min(1).max(256),
});


export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { email, name, password, org_name } = parsed.data;
    const ip = request.ip;
    const ua = request.headers['user-agent'] ?? '';

    const pwned = await isPasswordPwned(password);
    if (pwned) {
      return reply.status(422).send({
        code: 'PASSWORD_COMPROMISED',
        message: 'This password has appeared in data breaches. Please choose a different password.',
      });
    }

    const passwordHash = await hashPassword(password);

    const orgSlug = org_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check email uniqueness across the system for the same org
      const existing = await client.query(
        `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
        [email],
      );
      if ((existing.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        const err = new ConflictError('Email already registered');
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }

      const orgId = randomUUID();
      await client.query(
        `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`,
        [orgId, org_name, `${orgSlug}-${orgId.slice(0, 8)}`],
      );

      const userId = randomUUID();
      await client.query(
        `INSERT INTO users (id, org_id, email, name, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'org_admin')`,
        [userId, orgId, email, name, passwordHash],
      );

      const familyId = randomUUID();
      const accessToken = await signAccessToken({ sub: userId, org_id: orgId, role: 'org_admin' });
      const refreshToken = await signRefreshToken(familyId, userId, orgId);
      const refreshHash = createHash('sha256').update(refreshToken).digest('hex');

      await client.query(
        `INSERT INTO token_families (id, user_id, org_id, last_refresh_token_hash)
         VALUES ($1, $2, $3, $4)`,
        [familyId, userId, orgId, refreshHash],
      );

      await client.query('COMMIT');

      registerCounter.inc();
      await publishAudit({
        action: 'auth.register.success',
        actorType: 'user',
        actorId: userId,
        orgId,
        resourceType: 'user',
        resourceId: userId,
        ipAddress: ip,
        userAgent: ua,
      }).catch(() => undefined);

      return reply.status(201).send({
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
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
