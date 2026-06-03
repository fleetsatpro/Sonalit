import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { getJs } from '../nats.js';
import { StringCodec } from 'nats';
import { NotFoundError } from '../lib/errors.js';

const CreateReportSchema = z.object({
  type: z.enum(['convoy', 'fleet', 'driver']),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(['pdf', 'csv']).default('pdf'),
  params: z.record(z.unknown()).optional(),
});

const ListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v4/reports', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const q = ListSchema.parse(req.query);
    const rows = await query(
      'SELECT * FROM reports WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [org_id, q.limit, (q.page - 1) * q.limit],
    );
    return reply.send({ data: rows });
  });

  app.post('/v4/reports', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const body = CreateReportSchema.parse(req.body);
    const id = randomUUID();
    const [report] = await query(
      'INSERT INTO reports (id, org_id, title, type, status, params) VALUES ($1,$2,$3,$4,\'pending\',$5) RETURNING *',
      [id, org_id, `${body.type} report ${body.from} – ${body.to}`, body.type, JSON.stringify({ ...body.params, from: body.from, to: body.to, format: body.format })],
    );
    try {
      const js = getJs(); const sc = StringCodec();
      await js.publish('reports.generate', sc.encode(JSON.stringify({ report_id: id, org_id, ...body })));
    } catch { /* non-fatal */ }
    return reply.code(202).send(report);
  });

  app.get('/v4/reports/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const { id } = req.params as { id: string };
    const [row] = await query('SELECT * FROM reports WHERE id=$1 AND org_id=$2', [id, org_id]);
    if (!row) throw new NotFoundError('Report not found');
    return reply.send(row);
  });
};
