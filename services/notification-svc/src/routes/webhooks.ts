import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { query } from '../db.js';
import { NotFoundError, AuthError } from '../lib/errors.js';

const WebhookSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), 'URL must be HTTPS'),
  events: z.array(z.string().min(1)).min(1),
  active: z.boolean().default(true),
});

// Safe column allow-list to prevent SQL injection in PATCH.
const PATCHABLE_COLS = new Set(['url', 'events', 'active'] as const);
type PatchableCol = 'url' | 'events' | 'active';


export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v4/webhooks', async (req, reply) => {
    const orgId = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!orgId) throw new AuthError('x-org-id header required');

    const rows = await query(
      `SELECT id, url, events, active, created_at
       FROM webhooks WHERE org_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [orgId],
    );
    return reply.send({ data: rows });
  });

  app.post('/v4/webhooks', async (req, reply) => {
    const orgId = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!orgId) throw new AuthError('x-org-id header required');

    const body = WebhookSchema.parse(req.body);
    const secret = randomBytes(32).toString('hex');
    const signingSecret = createHmac('sha256', secret).update(orgId).digest('hex');

    const [row] = await query<{ id: string; url: string; events: string; active: boolean; created_at: string }>(
      `INSERT INTO webhooks (id, org_id, url, events, secret, active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, url, events, active, created_at`,
      [randomUUID(), orgId, body.url, JSON.stringify(body.events), signingSecret, body.active],
    );
    return reply.code(201).send({ ...row, secret });
  });

  app.get('/v4/webhooks/:id', async (req, reply) => {
    const orgId = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!orgId) throw new AuthError('x-org-id header required');
    const { id } = req.params as { id: string };

    const [row] = await query(
      `SELECT id, url, events, active, created_at
       FROM webhooks WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`,
      [id, orgId],
    );
    if (!row) throw new NotFoundError('Webhook not found');
    return reply.send(row);
  });

  app.patch('/v4/webhooks/:id', async (req, reply) => {
    const orgId = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!orgId) throw new AuthError('x-org-id header required');
    const { id } = req.params as { id: string };

    const body = WebhookSchema.partial().parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];

    for (const [k, v] of Object.entries(body) as [PatchableCol, unknown][]) {
      if (!PATCHABLE_COLS.has(k) || v === undefined) continue;
      params.push(k === 'events' ? JSON.stringify(v) : v);
      sets.push(`${k} = $${params.length}`);
    }

    if (!sets.length) return reply.code(400).send({ error: 'No patchable fields provided' });

    params.push(id, orgId);
    const [row] = await query(
      `UPDATE webhooks SET ${sets.join(', ')}, updated_at=NOW()
       WHERE id=$${params.length - 1} AND org_id=$${params.length} AND deleted_at IS NULL
       RETURNING id, url, events, active, created_at`,
      params,
    );
    if (!row) throw new NotFoundError('Webhook not found');
    return reply.send(row);
  });

  app.delete('/v4/webhooks/:id', async (req, reply) => {
    const orgId = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!orgId) throw new AuthError('x-org-id header required');
    const { id } = req.params as { id: string };

    await query(
      `UPDATE webhooks SET deleted_at=NOW() WHERE id=$1 AND org_id=$2`,
      [id, orgId],
    );
    return reply.code(204).send();
  });
};
