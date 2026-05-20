import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { getJs } from '../nats.js';
import { NotFoundError, ValidationError, AuthError } from '../lib/errors.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const CreateAlertSchema = z.object({
  type: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  vehicle_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const PatchAlertSchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'suppressed']).optional(),
  notes: z.string().optional(),
});

const ListQuerySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'suppressed']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

interface AlertRow {
  id: string;
  org_id: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  vehicle_id: string | null;
  driver_id: string | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  rule_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function requireUser(request: FastifyRequest, reply: FastifyReply): string {
  const user = request.user;
  if (!user) {
    const err = new AuthError();
    reply.status(err.statusCode).send({ code: err.code, message: err.message });
    return '';
  }
  return user.org_id;
}

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v4/alerts', async (request, reply) => {
    const orgId = requireUser(request, reply);
    if (!orgId) return;

    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid query');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { status, severity, page, limit } = parsed.data;
    const offset = (page - 1) * limit;
    const conditions: string[] = ['org_id = $1', 'deleted_at IS NULL'];
    const values: unknown[] = [orgId];
    let idx = 2;

    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (severity) { conditions.push(`severity = $${idx++}`); values.push(severity); }

    const where = conditions.join(' AND ');
    values.push(limit, offset);

    const rows = await query<AlertRow>(
      `SELECT * FROM alerts WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      values,
    );

    const [countRow] = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM alerts WHERE ${where}`,
      values.slice(0, -2),
    );

    return reply.status(200).send({
      data: rows,
      pagination: { page, limit, total: Number(countRow?.count ?? 0) },
    });
  });

  app.post('/v4/alerts', async (request, reply) => {
    const user = request.user;
    if (!user) {
      const err = new AuthError();
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const parsed = CreateAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { type, severity, title, description, vehicle_id, driver_id, metadata } = parsed.data;
    const id = randomUUID();

    const [row] = await query<AlertRow>(
      `INSERT INTO alerts (id, org_id, type, severity, title, description, vehicle_id, driver_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, user.org_id, type, severity, title, description ?? null, vehicle_id ?? null, driver_id ?? null, JSON.stringify(metadata ?? {})],
    );

    const js = getJs();
    const payload = {
      alert_id: id,
      org_id: user.org_id,
      type,
      severity,
      title,
      vehicle_id: vehicle_id ?? null,
      driver_id: driver_id ?? null,
      timestamp: new Date().toISOString(),
    };
    await js.publish('events.alert.new', Buffer.from(JSON.stringify(payload)));

    return reply.status(201).send(row);
  });

  app.get('/v4/alerts/:id', async (request, reply) => {
    const orgId = requireUser(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const [row] = await query<AlertRow>(
      `SELECT * FROM alerts WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );

    if (!row) {
      const err = new NotFoundError('Alert');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    return reply.status(200).send(row);
  });

  app.patch('/v4/alerts/:id', async (request, reply) => {
    const orgId = requireUser(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const parsed = PatchAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    if (parsed.data.status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(parsed.data.status);
    }
    if (parsed.data.notes !== undefined) {
      updates.push(`notes = $${idx++}`);
      values.push(parsed.data.notes);
    }

    values.push(id, orgId);

    const [row] = await query<AlertRow>(
      `UPDATE alerts SET ${updates.join(', ')}
       WHERE id = $${idx} AND org_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING *`,
      values,
    );

    if (!row) {
      const err = new NotFoundError('Alert');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    return reply.status(200).send(row);
  });

  app.delete('/v4/alerts/:id', async (request, reply) => {
    const orgId = requireUser(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const [row] = await query<AlertRow>(
      `UPDATE alerts SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, orgId],
    );

    if (!row) {
      const err = new NotFoundError('Alert');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    return reply.status(204).send();
  });
}
