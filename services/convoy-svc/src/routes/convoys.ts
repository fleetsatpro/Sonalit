import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { getJs } from '../nats.js';
import { StringCodec } from 'nats';
import { NotFoundError, AuthError } from '../lib/errors.js';

const ConvoyStatus = z.enum(['draft', 'planned', 'active', 'completed', 'cancelled']);

const CreateConvoySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  timezone: z.string().default('UTC'),
  start_date: z.string(),
  end_date: z.string(),
  seal_count_per_truck: z.number().int().nonnegative().optional(),
  vehicle_ids: z.array(z.string().uuid()).default([]),
  driver_ids: z.array(z.string().uuid()).default([]),
  notes: z.string().max(5000).optional(),
});

const PatchConvoySchema = CreateConvoySchema.partial().extend({ status: ConvoyStatus.optional() });

const ListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: ConvoyStatus.optional(),
});

// Safe column allow-list to prevent SQL injection in PATCH.
const PATCHABLE_COLS = new Set([
  'name', 'description', 'timezone', 'start_date', 'end_date',
  'seal_count_per_truck', 'notes', 'status',
] as const);
type PatchableCol = 'name' | 'description' | 'timezone' | 'start_date' | 'end_date' | 'seal_count_per_truck' | 'notes' | 'status';

const sc = StringCodec();

export const convoysRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v4/convoys', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) throw new AuthError('x-org-id header required');
    const q = ListSchema.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    const params: unknown[] = [org_id, q.limit, offset];
    let statusFilter = '';
    if (q.status) { params.push(q.status); statusFilter = `AND status = $${params.length}`; }
    const rows = await query(
      `SELECT * FROM convoys WHERE org_id = $1 AND deleted_at IS NULL ${statusFilter}
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      params,
    );
    return reply.send({ data: rows });
  });

  app.post('/v4/convoys', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) throw new AuthError('x-org-id header required');
    const body = CreateConvoySchema.parse(req.body);
    const id = randomUUID();
    const [convoy] = await query(
      `INSERT INTO convoys (id, org_id, name, description, timezone, start_date, end_date,
       seal_count_per_truck, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'planned') RETURNING *`,
      [id, org_id, body.name, body.description ?? null, body.timezone, body.start_date, body.end_date,
       body.seal_count_per_truck ?? null, body.notes ?? null],
    );
    for (const vid of body.vehicle_ids) {
      await query('INSERT INTO convoy_vehicles (convoy_id, vehicle_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, vid]);
    }
    for (const did of body.driver_ids) {
      await query('INSERT INTO convoy_drivers (convoy_id, driver_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, did]);
    }
    return reply.code(201).send(convoy);
  });

  app.get('/v4/convoys/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) throw new AuthError('x-org-id header required');
    const { id } = req.params as { id: string };
    const [convoy] = await query('SELECT * FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL', [id, org_id]);
    if (!convoy) throw new NotFoundError('Convoy not found');
    const vehicles = await query<{ vehicle_id: string }>('SELECT vehicle_id FROM convoy_vehicles WHERE convoy_id=$1', [id]);
    const drivers = await query<{ driver_id: string }>('SELECT driver_id FROM convoy_drivers WHERE convoy_id=$1', [id]);
    return reply.send({
      ...convoy,
      vehicle_ids: vehicles.map((v) => v.vehicle_id),
      driver_ids: drivers.map((d) => d.driver_id),
    });
  });

  app.patch('/v4/convoys/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) throw new AuthError('x-org-id header required');
    const { id } = req.params as { id: string };
    const body = PatchConvoySchema.parse(req.body);
    const { vehicle_ids, driver_ids, ...fields } = body;
    const sets: string[] = [];
    const params: unknown[] = [];

    for (const [k, v] of Object.entries(fields) as [PatchableCol, unknown][]) {
      if (!PATCHABLE_COLS.has(k) || v === undefined) continue;
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }

    let convoy: Record<string, unknown> = {};
    if (sets.length) {
      params.push(id, org_id);
      const [r] = await query(
        `UPDATE convoys SET ${sets.join(', ')}, updated_at=NOW()
         WHERE id=$${params.length - 1} AND org_id=$${params.length} AND deleted_at IS NULL
         RETURNING *`,
        params,
      );
      if (!r) throw new NotFoundError('Convoy not found');
      convoy = r as Record<string, unknown>;
      if (body.status === 'active') {
        try {
          const js = getJs();
          await js.publish(
            `convoy.updated.${org_id}`,
            sc.encode(JSON.stringify({ convoy_id: id, org_id, status: 'active' })),
            { msgID: id },
          );
        } catch { /* non-fatal — convoy record already updated */ }
      }
    }

    if (vehicle_ids !== undefined) {
      // Atomic replacement: delete then insert in a single client round-trip via CTE.
      await query(
        `WITH del AS (DELETE FROM convoy_vehicles WHERE convoy_id=$1)
         INSERT INTO convoy_vehicles (convoy_id, vehicle_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [id, vehicle_ids],
      );
    }
    if (driver_ids !== undefined) {
      await query(
        `WITH del AS (DELETE FROM convoy_drivers WHERE convoy_id=$1)
         INSERT INTO convoy_drivers (convoy_id, driver_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [id, driver_ids],
      );
    }
    return reply.send(convoy);
  });

  app.delete('/v4/convoys/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) throw new AuthError('x-org-id header required');
    const { id } = req.params as { id: string };
    await query('UPDATE convoys SET deleted_at=NOW() WHERE id=$1 AND org_id=$2', [id, org_id]);
    return reply.code(204).send();
  });
};
