import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError } from '../lib/errors.js';
import { getJs } from '../nats.js';
import { StringCodec } from 'nats';

const CreateMessageSchema = z.object({
  thread_id: z.string().uuid().optional(),
  to_user_id: z.string().uuid().optional(),
  body: z.string().min(1).max(10_000),
});

const ThreadQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const MessageQuerySchema = ThreadQuerySchema.extend({
  thread_id: z.string().uuid(),
});

export const messagesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/v4/messages/threads', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const q = ThreadQuerySchema.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    const rows = await query<{ id: string; subject: string; last_message_at: string; participant_count: number }>(
      `SELECT t.id, t.subject, t.last_message_at,
              COUNT(DISTINCT tp.user_id)::int AS participant_count
       FROM message_threads t
       JOIN thread_participants tp ON tp.thread_id = t.id
       WHERE t.org_id = $1 AND t.deleted_at IS NULL
       GROUP BY t.id
       ORDER BY t.last_message_at DESC
       LIMIT $2 OFFSET $3`,
      [org_id, q.limit, offset],
    );
    return reply.send({ data: rows });
  });

  app.get('/v4/messages', async (req, reply) => {
    const { org_id } = (req as typeof req & { user: { org_id: string } }).user;
    const q = MessageQuerySchema.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    const thread = await query<{ org_id: string }>(
      'SELECT org_id FROM message_threads WHERE id = $1 AND deleted_at IS NULL',
      [q.thread_id],
    );
    if (!thread[0] || thread[0].org_id !== org_id) throw new NotFoundError('Thread not found');
    const rows = await query(
      `SELECT id, sender_id, body, created_at
       FROM messages
       WHERE thread_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [q.thread_id, q.limit, offset],
    );
    return reply.send({ data: rows });
  });

  app.post('/v4/messages', async (req, reply) => {
    const user = (req as typeof req & { user: { id: string; org_id: string } }).user;
    const body = CreateMessageSchema.parse(req.body);
    let threadId = body.thread_id;
    if (!threadId) {
      const [t] = await query<{ id: string }>(
        `INSERT INTO message_threads (id, org_id, subject, last_message_at)
         VALUES ($1, $2, $3, NOW()) RETURNING id`,
        [randomUUID(), user.org_id, 'Direct message'],
      );
      if (!t) throw new Error('Thread insert returned no row');
      threadId = t.id;
    }
    const [msg] = await query<{ id: string; created_at: string }>(
      `INSERT INTO messages (id, thread_id, sender_id, body)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [randomUUID(), threadId, user.id, body.body],
    );
    if (!msg) throw new Error('Message insert returned no row');
    await query('UPDATE message_threads SET last_message_at = NOW() WHERE id = $1', [threadId]);
    try {
      const js = getJs();
      const sc = StringCodec();
      await js.publish('messages.new', sc.encode(JSON.stringify({ msg_id: msg.id, thread_id: threadId, org_id: user.org_id })));
    } catch { /* non-fatal */ }
    return reply.code(201).send({ id: msg.id, thread_id: threadId, created_at: msg.created_at });
  });
};
