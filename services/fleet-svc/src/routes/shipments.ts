import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError, ValidationError, AppError } from '../lib/errors.js';
import { shipmentOpsCounter } from '../lib/metrics.js';

const ShipmentStatus = z.enum([
  'pending',
  'assigned',
  'in_transit',
  'delivered',
  'cancelled',
  'failed',
]);

const CreateShipmentSchema = z.object({
  origin: z.string().min(1).max(500),
  destination: z.string().min(1).max(500),
  cargo_description: z.string().max(2000).optional(),
  status: ShipmentStatus.default('pending'),
  vehicle_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  scheduled_at: z.string().datetime(),
  delivered_at: z.string().datetime().optional(),
});

const PatchShipmentSchema = CreateShipmentSchema.partial();

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: ShipmentStatus.optional(),
  vehicle_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
});

interface ShipmentRow {
  id: string;
  org_id: string;
  shipment_number: string;
  origin: string;
  destination: string;
  cargo_description: string | null;
  status: string;
  vehicle_id: string | null;
  driver_id: string | null;
  scheduled_at: string;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function generateShipmentNumber(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `SHP-${datePart}-${rand}`;
}

export const shipmentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/v4/shipments', async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { page, limit, status, vehicle_id, driver_id } = parsed.data;
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
    if (driver_id) {
      conditions.push(`driver_id = $${idx++}`);
      values.push(driver_id);
    }

    const where = conditions.join(' AND ');
    const rows = await query<ShipmentRow>(
      `SELECT * FROM shipments WHERE ${where} ORDER BY scheduled_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset],
    );

    const [countRow] = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM shipments WHERE ${where}`,
      values,
    );

    shipmentOpsCounter.inc({ operation: 'list', result: 'ok' });
    await reply.send({ data: rows, total: Number(countRow?.count ?? 0), page, limit });
  });

  app.post('/v4/shipments', async (request, reply) => {
    const parsed = CreateShipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { origin, destination, cargo_description, status, vehicle_id, driver_id, scheduled_at, delivered_at } =
      parsed.data;
    const orgId = request.user!.org_id;
    const shipment_number = generateShipmentNumber();

    const [row] = await query<ShipmentRow>(
      `INSERT INTO shipments
         (org_id, shipment_number, origin, destination, cargo_description, status, vehicle_id, driver_id, scheduled_at, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        orgId,
        shipment_number,
        origin,
        destination,
        cargo_description ?? null,
        status,
        vehicle_id ?? null,
        driver_id ?? null,
        scheduled_at,
        delivered_at ?? null,
      ],
    );

    if (!row) throw new AppError('INSERT_FAILED', 'Failed to create shipment', 500);
    shipmentOpsCounter.inc({ operation: 'create', result: 'ok' });
    await reply.status(201).send(row);
  });

  app.get('/v4/shipments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const [row] = await query<ShipmentRow>(
      `SELECT * FROM shipments WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('Shipment');
    shipmentOpsCounter.inc({ operation: 'get', result: 'ok' });
    await reply.send(row);
  });

  app.patch('/v4/shipments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const parsed = PatchShipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const updates = parsed.data;
    const fields = Object.keys(updates) as Array<keyof typeof updates>;
    if (fields.length === 0) throw new ValidationError('No fields to update');

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
    const values = fields.map((f) => updates[f] ?? null);

    const [row] = await query<ShipmentRow>(
      `UPDATE shipments SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, orgId, ...values],
    );
    if (!row) throw new NotFoundError('Shipment');
    shipmentOpsCounter.inc({ operation: 'update', result: 'ok' });
    await reply.send(row);
  });

  app.delete('/v4/shipments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const [row] = await query<ShipmentRow>(
      `UPDATE shipments SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('Shipment');
    shipmentOpsCounter.inc({ operation: 'delete', result: 'ok' });
    await reply.status(204).send();
  });
};
