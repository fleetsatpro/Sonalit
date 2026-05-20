import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { NotFoundError } from '../lib/errors.js';

const CreateDocSchema = z.object({
  name: z.string().min(1).max(255),
  kind: z.string().min(1).max(50),
  r2_key: z.string().min(1),
  size_bytes: z.number().int().nonnegative().optional(),
});

const ListSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });

export const documentsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v4/documents', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const q = ListSchema.parse(req.query);
    const { rows } = await query('SELECT * FROM media_assets WHERE org_id=$1 AND kind!=\'photo\' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2 OFFSET $3', [org_id, q.limit, (q.page - 1) * q.limit]);
    return reply.send({ data: rows });
  });
  app.post('/v4/documents', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const body = CreateDocSchema.parse(req.body);
    const { rows: [row] } = await query('INSERT INTO media_assets (id, org_id, kind, status, r2_key, size_bytes, name) VALUES ($1,$2,$3,\'committed\',$4,$5,$6) RETURNING *',
      [randomUUID(), org_id, body.kind, body.r2_key, body.size_bytes ?? null, body.name]);
    return reply.code(201).send(row);
  });
  app.delete('/v4/documents/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const { id } = req.params as { id: string };
    const { rows: [row] } = await query('UPDATE media_assets SET deleted_at=NOW() WHERE id=$1 AND org_id=$2 RETURNING id', [id, org_id]);
    if (!row) throw new NotFoundError('Document not found');
    return reply.code(204).send();
  });
};
