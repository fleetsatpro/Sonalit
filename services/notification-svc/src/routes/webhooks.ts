import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID, createHmac } from 'node:crypto';
import { query } from '../db.js';
import { NotFoundError } from '../lib/errors.js';

const WebhookSchema = z.object({
  url: z.string().url().refine(u => u.startsWith('https://'), 'URL must be HTTPS'),
  events: z.array(z.string().min(1)).min(1),
  active: z.boolean().default(true),
});

export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v4/webhooks', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const { rows } = await query('SELECT id, url, events, active, created_at FROM webhooks WHERE org_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC', [org_id]);
    return reply.send({ data: rows });
  });
  app.post('/v4/webhooks', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const body = WebhookSchema.parse(req.body);
    const secret = createHmac('sha256', randomUUID()).update(org_id).digest('hex');
    const { rows: [row] } = await query(
      'INSERT INTO webhooks (id, org_id, url, events, secret, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, url, events, active, created_at',
      [randomUUID(), org_id, body.url, JSON.stringify(body.events), secret, body.active],
    );
    return reply.code(201).send({ ...row, secret });
  });
  app.get('/v4/webhooks/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const { id } = req.params as { id: string };
    const { rows: [row] } = await query('SELECT id, url, events, active, created_at FROM webhooks WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL', [id, org_id]);
    if (!row) throw new NotFoundError('Webhook not found');
    return reply.send(row);
  });
  app.patch('/v4/webhooks/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const { id } = req.params as { id: string };
    const body = WebhookSchema.partial().parse(req.body);
    const sets: string[] = []; const params: unknown[] = [];
    for (const [k, v] of Object.entries(body)) { if (v !== undefined) { params.push(k === 'events' ? JSON.stringify(v) : v); sets.push(`${k}=$${params.length}`); } }
    if (!sets.length) return reply.code(400).send({ error: 'No fields to update' });
    params.push(id, org_id);
    const { rows: [row] } = await query(`UPDATE webhooks SET ${sets.join(',')} WHERE id=$${params.length-1} AND org_id=$${params.length} RETURNING *`, params);
    if (!row) throw new NotFoundError('Webhook not found');
    return reply.send(row);
  });
  app.delete('/v4/webhooks/:id', async (req, reply) => {
    const org_id = (req.headers['x-org-id'] as string) ?? '';
    const { id } = req.params as { id: string };
    await query('UPDATE webhooks SET deleted_at=NOW() WHERE id=$1 AND org_id=$2', [id, org_id]);
    return reply.code(204).send();
  });
};
