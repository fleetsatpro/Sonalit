import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { hashPassword, verifyPassword, isPasswordPwned } from '../lib/password.js';
import { publishAudit } from '../lib/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors.js';

const PatchMeSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  email: z.string().email().optional(),
  current_password: z.string().optional(),
  new_password: z.string().min(12).max(128).optional(),
}).refine(
  (obj) => Object.values(obj).some((v) => v !== undefined),
  { message: 'At least one field must be provided' },
);

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: string;
  totp_enabled: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  password_hash: string | null;
}

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user!;
    const rows = await query<UserRow>(
      `SELECT id, org_id, email, name, role, totp_enabled, created_at, updated_at, deleted_at
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [user.sub],
    );
    const row = rows[0];
    if (!row) {
      const err = new NotFoundError('User');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    return reply.status(200).send({
      id: row.id,
      org_id: row.org_id,
      email: row.email,
      name: row.name,
      role: row.role,
      totp_enabled: row.totp_enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  });

  app.patch('/me', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.user!;
    const ip = request.ip;
    const ua = request.headers['user-agent'] ?? '';

    const parsed = PatchMeSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }
    const updates = parsed.data;

    const rows = await query<UserRow>(
      `SELECT id, org_id, email, name, role, totp_enabled, created_at, updated_at, deleted_at, password_hash
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [authUser.sub],
    );
    const existing = rows[0];
    if (!existing) {
      const err = new NotFoundError('User');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    if (updates.new_password) {
      if (!updates.current_password) {
        const err = new ValidationError('current_password is required to change password');
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }
      if (!existing.password_hash) {
        const err = new ValidationError('Account does not have a password set');
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }
      const valid = await verifyPassword(existing.password_hash, updates.current_password);
      if (!valid) {
        return reply.status(401).send({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' });
      }
      const pwned = await isPasswordPwned(updates.new_password);
      if (pwned) {
        return reply.status(422).send({
          code: 'PASSWORD_COMPROMISED',
          message: 'This password has appeared in data breaches.',
        });
      }
    }

    if (updates.email && updates.email !== existing.email) {
      const conflict = await query(
        `SELECT id FROM users WHERE email = $1 AND org_id = $2 AND deleted_at IS NULL AND id != $3 LIMIT 1`,
        [updates.email, existing.org_id, existing.id],
      );
      if (conflict.length > 0) {
        const err = new ConflictError('Email already in use');
        return reply.status(err.statusCode).send({ code: err.code, message: err.message });
      }
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.name) { setClauses.push(`name = $${idx++}`); values.push(updates.name); }
    if (updates.email) { setClauses.push(`email = $${idx++}`); values.push(updates.email); }
    if (updates.new_password) {
      const newHash = await hashPassword(updates.new_password);
      setClauses.push(`password_hash = $${idx++}`);
      values.push(newHash);
    }
    setClauses.push(`updated_at = NOW()`);
    values.push(existing.id);

    await query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      values,
    );

    await publishAudit({
      action: 'user.profile.updated',
      actorType: 'user',
      actorId: authUser.sub,
      orgId: authUser.org_id,
      resourceType: 'user',
      resourceId: authUser.sub,
      beforeState: { name: existing.name, email: existing.email },
      afterState: { name: updates.name ?? existing.name, email: updates.email ?? existing.email },
      ipAddress: ip,
      userAgent: ua,
    }).catch(() => undefined);

    const updated = await query<UserRow>(
      `SELECT id, org_id, email, name, role, totp_enabled, created_at, updated_at
       FROM users WHERE id = $1 LIMIT 1`,
      [authUser.sub],
    );
    return reply.status(200).send(updated[0]);
  });
}
