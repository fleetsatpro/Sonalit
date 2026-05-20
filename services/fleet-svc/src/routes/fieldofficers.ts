import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError } from '../lib/errors.js';

const OfficerStatus = z.enum(['available', 'busy', 'offline']);

const CreateOfficerSchema = z.object({
  name: z.string().min(1).max(255),
  badge_number: z.string().min(1).max(50),
  phone: z.string().min(1).max(30),
  assigned_zone: z.string().max(255).optional(),
  status: OfficerStatus.default('offline'),
});

const PatchOfficerSchema = CreateOfficerSchema.partial();
const ListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: OfficerStatus.optional(),
});

export const fieldOfficersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth(app));

  app.get('/v4/field-officers', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const q = ListSchema.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    const params: unknown[] = [org_id, q.limit, offset];
    let statusFilter = '';
    if (q.status) { params.push(q.status); statusFilter = `AND status = $${params.length}`; }
    const { rows } = await query(
      `SELECT * FROM field_officers WHERE org_id = $1 AND deleted_at IS NULL ${statusFilter}
       ORDER BY name LIMIT $2 OFFSET $3`,
      params,
    );
    return reply.send({ data: rows });
  });

  app.post('/v4/field-officers', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const body = CreateOfficerSchema.parse(req.body);
    const { rows: [row] } = await query(
      `INSERT INTO field_officers (id, org_id, name, badge_number, phone, assigned_zone, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [randomUUID(), org_id, body.name, body.badge_number, body.phone, body.assigned_zone ?? null, body.status],
    );
    return reply.code(201).send(row);
  });

  app.get('/v4/field-officers/:id', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const { id } = req.params as { id: string };
    const { rows: [row] } = await query(
      'SELECT * FROM field_officers WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL',
      [id, org_id],
    );
    if (!row) throw new NotFoundError('Officer not found');
    return reply.send(row);
  });

  app.patch('/v4/field-officers/:id', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const { id } = req.params as { id: string };
    const body = PatchOfficerSchema.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) { params.push(v); sets.push(`${k} = $${params.length}`); }
    }
    if (!sets.length) { const { rows: [r] } = await query('SELECT * FROM field_officers WHERE id=$1 AND org_id=$2', [id, org_id]); return reply.send(r); }
    params.push(id, org_id);
    const { rows: [row] } = await query(
      `UPDATE field_officers SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND org_id=$${params.length} AND deleted_at IS NULL RETURNING *`,
      params,
    );
    if (!row) throw new NotFoundError('Officer not found');
    return reply.send(row);
  });

  app.delete('/v4/field-officers/:id', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const { id } = req.params as { id: string };
    await query('UPDATE field_officers SET deleted_at=NOW() WHERE id=$1 AND org_id=$2', [id, org_id]);
    return reply.code(204).send();
  });
};
