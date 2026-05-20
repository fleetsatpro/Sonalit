import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { NotFoundError, ValidationError, AuthError } from '../lib/errors.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const CreateRuleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  condition_type: z.enum(['speed', 'geofence', 'idle', 'battery']),
  threshold: z.number(),
  action_type: z.enum(['alert', 'notify']),
  enabled: z.boolean().default(true),
});

const PatchRuleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  condition_type: z.enum(['speed', 'geofence', 'idle', 'battery']).optional(),
  threshold: z.number().optional(),
  action_type: z.enum(['alert', 'notify']).optional(),
  enabled: z.boolean().optional(),
});

interface RuleRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  condition_type: string;
  threshold: number;
  action_type: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function requireOrgId(request: FastifyRequest, reply: FastifyReply): string {
  const user = request.user;
  if (!user) {
    const err = new AuthError();
    reply.status(err.statusCode).send({ code: err.code, message: err.message });
    return '';
  }
  return user.org_id;
}

export async function rulesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v4/rules', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const rows = await query<RuleRow>(
      `SELECT * FROM rules WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [orgId],
    );

    return reply.status(200).send({ data: rows });
  });

  app.post('/v4/rules', async (request, reply) => {
    const user = request.user;
    if (!user) {
      const err = new AuthError();
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const parsed = CreateRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { name, description, condition_type, threshold, action_type, enabled } = parsed.data;
    const id = randomUUID();

    const [row] = await query<RuleRow>(
      `INSERT INTO rules (id, org_id, name, description, condition_type, threshold, action_type, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, user.org_id, name, description ?? null, condition_type, threshold, action_type, enabled],
    );

    return reply.status(201).send(row);
  });

  app.get('/v4/rules/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const [row] = await query<RuleRow>(
      `SELECT * FROM rules WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );

    if (!row) {
      const err = new NotFoundError('Rule');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    return reply.status(200).send(row);
  });

  app.patch('/v4/rules/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const parsed = PatchRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    const fields = ['name', 'description', 'condition_type', 'threshold', 'action_type', 'enabled'] as const;
    for (const field of fields) {
      if (parsed.data[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        values.push(parsed.data[field]);
      }
    }

    values.push(id, orgId);

    const [row] = await query<RuleRow>(
      `UPDATE rules SET ${updates.join(', ')}
       WHERE id = $${idx} AND org_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING *`,
      values,
    );

    if (!row) {
      const err = new NotFoundError('Rule');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    return reply.status(200).send(row);
  });

  app.delete('/v4/rules/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const [row] = await query<RuleRow>(
      `UPDATE rules SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, orgId],
    );

    if (!row) {
      const err = new NotFoundError('Rule');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    return reply.status(204).send();
  });
}
