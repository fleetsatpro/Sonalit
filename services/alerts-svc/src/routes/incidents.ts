import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { getJs } from '../nats.js';
import { NotFoundError, ValidationError, AuthError } from '../lib/errors.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const CreateIncidentSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  assigned_to_id: z.string().uuid().optional(),
});

const PatchIncidentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['open', 'investigating', 'resolved']).optional(),
  assigned_to_id: z.string().uuid().optional(),
});

const IncidentActionSchema = z.object({
  action_type: z.string().min(1),
  notes: z.string().optional(),
  actor_id: z.string().uuid(),
});

interface IncidentRow {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  assigned_to_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface IncidentActionRow {
  id: string;
  incident_id: string;
  action_type: string;
  notes: string | null;
  actor_id: string;
  created_at: Date;
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

export async function incidentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v4/incidents', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const rows = await query<IncidentRow>(
      `SELECT * FROM incidents WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [orgId],
    );

    return reply.status(200).send({ data: rows });
  });

  app.post('/v4/incidents', async (request, reply) => {
    const user = request.user;
    if (!user) {
      const err = new AuthError();
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const parsed = CreateIncidentSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { title, description, severity, assigned_to_id } = parsed.data;
    const id = randomUUID();

    const [row] = await query<IncidentRow>(
      `INSERT INTO incidents (id, org_id, title, description, severity, assigned_to_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, user.org_id, title, description ?? null, severity, assigned_to_id ?? null],
    );

    const js = getJs();
    const payload = {
      incident_id: id,
      org_id: user.org_id,
      title,
      severity,
      status: 'open',
      timestamp: new Date().toISOString(),
    };
    await js.publish('events.incident.created', Buffer.from(JSON.stringify(payload)));

    return reply.status(201).send(row);
  });

  app.get('/v4/incidents/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const [incident] = await query<IncidentRow>(
      `SELECT * FROM incidents WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );

    if (!incident) {
      const err = new NotFoundError('Incident');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const actions = await query<IncidentActionRow>(
      `SELECT * FROM incident_actions WHERE incident_id = $1 ORDER BY created_at ASC`,
      [id],
    );

    return reply.status(200).send({ ...incident, actions });
  });

  app.patch('/v4/incidents/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const parsed = PatchIncidentSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const [current] = await query<IncidentRow>(
      `SELECT status FROM incidents WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );

    if (!current) {
      const err = new NotFoundError('Incident');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    const fields = ['title', 'description', 'severity', 'status', 'assigned_to_id'] as const;
    for (const field of fields) {
      if (parsed.data[field] !== undefined) {
        updates.push(`${field} = $${idx++}`);
        values.push(parsed.data[field]);
      }
    }

    values.push(id, orgId);

    const [row] = await query<IncidentRow>(
      `UPDATE incidents SET ${updates.join(', ')}
       WHERE id = $${idx} AND org_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING *`,
      values,
    );

    if (!row) {
      const err = new NotFoundError('Incident');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const newStatus = parsed.data.status;
    if (newStatus && newStatus !== current.status) {
      const js = getJs();
      const payload = {
        incident_id: id,
        org_id: orgId,
        previous_status: current.status,
        new_status: newStatus,
        timestamp: new Date().toISOString(),
      };
      await js.publish('events.incident.updated', Buffer.from(JSON.stringify(payload)));
    }

    return reply.status(200).send(row);
  });

  app.delete('/v4/incidents/:id', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const [row] = await query<IncidentRow>(
      `UPDATE incidents SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, orgId],
    );

    if (!row) {
      const err = new NotFoundError('Incident');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    return reply.status(204).send();
  });

  app.post('/v4/incidents/:id/actions', async (request, reply) => {
    const orgId = requireOrgId(request, reply);
    if (!orgId) return;

    const { id } = request.params as { id: string };

    const parsed = IncidentActionSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid input');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const [incident] = await query<{ id: string }>(
      `SELECT id FROM incidents WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );

    if (!incident) {
      const err = new NotFoundError('Incident');
      return reply.status(err.statusCode).send({ code: err.code, message: err.message });
    }

    const { action_type, notes, actor_id } = parsed.data;
    const actionId = randomUUID();

    const [action] = await query<IncidentActionRow>(
      `INSERT INTO incident_actions (id, incident_id, action_type, notes, actor_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [actionId, id, action_type, notes ?? null, actor_id],
    );

    return reply.status(201).send(action);
  });
}
