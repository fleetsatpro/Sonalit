import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError, ValidationError, AppError } from '../lib/errors.js';
import { driverOpsCounter } from '../lib/metrics.js';

const DriverStatus = z.enum(['on_duty', 'off_duty', 'suspended']);

const CreateDriverSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(30).optional(),
  license_number: z.string().min(1).max(50),
  license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: DriverStatus.default('off_duty'),
});

const PatchDriverSchema = CreateDriverSchema.partial();

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: DriverStatus.optional(),
  search: z.string().max(200).optional(),
});

interface DriverRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  phone: string | null;
  license_number: string;
  license_expiry: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const driverRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/v4/drivers', async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { page, limit, status, search } = parsed.data;
    const offset = (page - 1) * limit;
    const orgId = request.user!.org_id;

    const conditions: string[] = ['org_id = $1', 'deleted_at IS NULL'];
    const values: unknown[] = [orgId];
    let idx = 2;

    if (status) {
      conditions.push(`status = $${idx++}`);
      values.push(status);
    }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR license_number ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.join(' AND ');
    const rows = await query<DriverRow>(
      `SELECT * FROM drivers WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset],
    );

    const [countRow] = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM drivers WHERE ${where}`,
      values,
    );

    driverOpsCounter.inc({ operation: 'list', result: 'ok' });
    await reply.send({ data: rows, total: Number(countRow?.count ?? 0), page, limit });
  });

  app.post('/v4/drivers', async (request, reply) => {
    const parsed = CreateDriverSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { name, email, phone, license_number, license_expiry, status } = parsed.data;
    const orgId = request.user!.org_id;

    const [row] = await query<DriverRow>(
      `INSERT INTO drivers (org_id, name, email, phone, license_number, license_expiry, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [orgId, name, email, phone ?? null, license_number, license_expiry, status],
    );

    if (!row) throw new AppError('INSERT_FAILED', 'Failed to create driver', 500);
    driverOpsCounter.inc({ operation: 'create', result: 'ok' });
    await reply.status(201).send(row);
  });

  app.get('/v4/drivers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const [row] = await query<DriverRow>(
      `SELECT * FROM drivers WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('Driver');
    driverOpsCounter.inc({ operation: 'get', result: 'ok' });
    await reply.send(row);
  });

  app.patch('/v4/drivers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const parsed = PatchDriverSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const updates = parsed.data;
    const fields = Object.keys(updates) as Array<keyof typeof updates>;
    if (fields.length === 0) throw new ValidationError('No fields to update');

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
    const values = fields.map((f) => updates[f]);

    const [row] = await query<DriverRow>(
      `UPDATE drivers SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, orgId, ...values],
    );
    if (!row) throw new NotFoundError('Driver');
    driverOpsCounter.inc({ operation: 'update', result: 'ok' });
    await reply.send(row);
  });

  app.delete('/v4/drivers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const [row] = await query<DriverRow>(
      `UPDATE drivers SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('Driver');
    driverOpsCounter.inc({ operation: 'delete', result: 'ok' });
    await reply.status(204).send();
  });
};
