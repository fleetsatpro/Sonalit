import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError, ValidationError, AppError } from '../lib/errors.js';
import { maintenanceOpsCounter } from '../lib/metrics.js';

const MaintenanceStatus = z.enum(['scheduled', 'in_progress', 'completed', 'overdue']);

const CreateMaintenanceSchema = z.object({
  vehicle_id: z.string().uuid(),
  type: z.string().min(1).max(100),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: MaintenanceStatus.default('scheduled'),
  notes: z.string().max(2000).optional(),
  cost: z.number().nonnegative().optional(),
});

const PatchMaintenanceSchema = CreateMaintenanceSchema.partial();

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: MaintenanceStatus.optional(),
  vehicle_id: z.string().uuid().optional(),
});

interface MaintenanceRow {
  id: string;
  org_id: string;
  vehicle_id: string;
  type: string;
  scheduled_date: string;
  completed_date: string | null;
  status: string;
  notes: string | null;
  cost: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const maintenanceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/v4/maintenance', async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { page, limit, status, vehicle_id } = parsed.data;
    const offset = (page - 1) * limit;
    const orgId = request.user!.org_id;

    const conditions: string[] = ['org_id = $1', 'deleted_at IS NULL'];
    const values: unknown[] = [orgId];
    let idx = 2;

    if (status) {
      conditions.push(`status = $${idx++}`);
      values.push(status);
    }
    if (vehicle_id) {
      conditions.push(`vehicle_id = $${idx++}`);
      values.push(vehicle_id);
    }

    const where = conditions.join(' AND ');
    const rows = await query<MaintenanceRow>(
      `SELECT * FROM maintenance_records WHERE ${where} ORDER BY scheduled_date DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset],
    );

    const [countRow] = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM maintenance_records WHERE ${where}`,
      values,
    );

    maintenanceOpsCounter.inc({ operation: 'list', result: 'ok' });
    await reply.send({ data: rows, total: Number(countRow?.count ?? 0), page, limit });
  });

  app.post('/v4/maintenance', async (request, reply) => {
    const parsed = CreateMaintenanceSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { vehicle_id, type, scheduled_date, completed_date, status, notes, cost } = parsed.data;
    const orgId = request.user!.org_id;

    const [row] = await query<MaintenanceRow>(
      `INSERT INTO maintenance_records
         (org_id, vehicle_id, type, scheduled_date, completed_date, status, notes, cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [orgId, vehicle_id, type, scheduled_date, completed_date ?? null, status, notes ?? null, cost ?? null],
    );

    if (!row) throw new AppError('INSERT_FAILED', 'Failed to create maintenance record', 500);
    maintenanceOpsCounter.inc({ operation: 'create', result: 'ok' });
    await reply.status(201).send(row);
  });

  app.get('/v4/maintenance/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const [row] = await query<MaintenanceRow>(
      `SELECT * FROM maintenance_records WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('MaintenanceRecord');
    maintenanceOpsCounter.inc({ operation: 'get', result: 'ok' });
    await reply.send(row);
  });

  app.patch('/v4/maintenance/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const parsed = PatchMaintenanceSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const updates = parsed.data;
    const fields = Object.keys(updates) as Array<keyof typeof updates>;
    if (fields.length === 0) throw new ValidationError('No fields to update');

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
    const values = fields.map((f) => updates[f] ?? null);

    const [row] = await query<MaintenanceRow>(
      `UPDATE maintenance_records SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, orgId, ...values],
    );
    if (!row) throw new NotFoundError('MaintenanceRecord');
    maintenanceOpsCounter.inc({ operation: 'update', result: 'ok' });
    await reply.send(row);
  });

  app.delete('/v4/maintenance/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const [row] = await query<MaintenanceRow>(
      `UPDATE maintenance_records SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('MaintenanceRecord');
    maintenanceOpsCounter.inc({ operation: 'delete', result: 'ok' });
    await reply.status(204).send();
  });
};
