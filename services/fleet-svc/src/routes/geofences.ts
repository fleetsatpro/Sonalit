import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError, ValidationError, AppError } from '../lib/errors.js';

const GeofenceType = z.enum(['entry', 'exit', 'both']);

const GeoJsonGeometrySchema = z.object({
  type: z.string(),
  coordinates: z.unknown(),
});

const CreateGeofenceSchema = z.object({
  name: z.string().min(1).max(200),
  type: GeofenceType.default('both'),
  geojson: GeoJsonGeometrySchema,
  active: z.boolean().default(true),
});

const PatchGeofenceSchema = CreateGeofenceSchema.partial();

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});

interface GeofenceRow {
  id: string;
  org_id: string;
  name: string;
  type: string;
  geojson: unknown;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const geofenceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/v4/geofences', async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { page, limit, active } = parsed.data;
    const offset = (page - 1) * limit;
    const orgId = request.user!.org_id;

    const conditions: string[] = ['org_id = $1', 'deleted_at IS NULL'];
    const values: unknown[] = [orgId];
    let idx = 2;

    if (active !== undefined) {
      conditions.push(`active = $${idx++}`);
      values.push(active);
    }

    const where = conditions.join(' AND ');
    const rows = await query<GeofenceRow>(
      `SELECT * FROM geofences WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset],
    );

    const [countRow] = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM geofences WHERE ${where}`,
      values,
    );

    await reply.send({ data: rows, total: Number(countRow?.count ?? 0), page, limit });
  });

  app.post('/v4/geofences', async (request, reply) => {
    const parsed = CreateGeofenceSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { name, type, geojson, active } = parsed.data;
    const orgId = request.user!.org_id;

    const [row] = await query<GeofenceRow>(
      `INSERT INTO geofences (org_id, name, type, geojson, active)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING *`,
      [orgId, name, type, JSON.stringify(geojson), active],
    );

    if (!row) throw new AppError('INSERT_FAILED', 'Failed to create geofence', 500);
    await reply.status(201).send(row);
  });

  app.get('/v4/geofences/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const [row] = await query<GeofenceRow>(
      `SELECT * FROM geofences WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('Geofence');
    await reply.send(row);
  });

  app.patch('/v4/geofences/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const parsed = PatchGeofenceSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const updates = parsed.data;
    const rawFields = Object.keys(updates) as Array<keyof typeof updates>;
    if (rawFields.length === 0) throw new ValidationError('No fields to update');

    const setClauses = rawFields
      .map((f, i) => (f === 'geojson' ? `${f} = $${i + 3}::jsonb` : `${f} = $${i + 3}`))
      .join(', ');
    const values = rawFields.map((f) => (f === 'geojson' ? JSON.stringify(updates[f]) : updates[f]));

    const [row] = await query<GeofenceRow>(
      `UPDATE geofences SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, orgId, ...values],
    );
    if (!row) throw new NotFoundError('Geofence');
    await reply.send(row);
  });

  app.delete('/v4/geofences/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.user!.org_id;

    const [row] = await query<GeofenceRow>(
      `UPDATE geofences SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('Geofence');
    await reply.status(204).send();
  });
};
