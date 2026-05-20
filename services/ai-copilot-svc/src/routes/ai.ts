import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, pool } from '../db.js';
import { redis } from '../redis.js';
import { withCircuitBreaker, CircuitOpenError } from '../lib/circuit-breaker.js';
import type { AiDecision } from '../db.js';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';
const SESSION_MAX_MESSAGES = 10;
const SESSION_TTL_S = 3600;

const QuerySchema = z.object({
  query: z.string().min(1).max(4000),
  context: z.string().max(8000).optional(),
});

const CopilotSchema = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.string().uuid().optional(),
});

const DecisionsQuerySchema = z.object({
  org_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const raw = await redis.get(`ai:session:${sessionId}`);
  if (!raw) return [];
  return JSON.parse(raw) as SessionMessage[];
}

async function saveSessionMessages(sessionId: string, messages: SessionMessage[]): Promise<void> {
  const trimmed = messages.slice(-SESSION_MAX_MESSAGES);
  await redis.setex(`ai:session:${sessionId}`, SESSION_TTL_S, JSON.stringify(trimmed));
}

function setSseHeaders(reply: FastifyReply): void {
  void reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

async function storeDecision(orgId: string, userId: string, userQuery: string, response: string): Promise<void> {
  await pool.query(
    `INSERT INTO ai_decisions (id, org_id, user_id, query, response, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [randomUUID(), orgId, userId, userQuery, response]
  );
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v4/ai/query', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = QuerySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: body.error.issues });
    }

    const { query: userQuery, context } = body.data;
    const orgId = (req.headers['x-org-id'] as string) ?? 'unknown';
    const userId = (req.headers['x-user-id'] as string) ?? 'unknown';

    setSseHeaders(reply);

    let fullResponse = '';

    try {
      await withCircuitBreaker(async () => {
        const stream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: context ? `Context:\n${context}\n\nQuery:\n${userQuery}` : userQuery,
            },
          ],
        });

        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            fullResponse += chunk.delta.text;
            reply.raw.write(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`);
          }
        }
      });
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        reply.raw.write(`data: ${JSON.stringify({ error: 'Service temporarily unavailable' })}\n\n`);
      } else {
        reply.raw.write(`data: ${JSON.stringify({ error: 'AI query failed' })}\n\n`);
      }
      reply.raw.end();
      return;
    }

    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();

    try {
      await storeDecision(orgId, userId, userQuery, fullResponse);
    } catch (storeErr) {
      req.log.warn({ err: storeErr }, 'Failed to store ai_decision');
    }
  });

  app.post('/v4/ai/copilot', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = CopilotSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: body.error.issues });
    }

    const { message, session_id } = body.data;
    const sessionId = session_id ?? randomUUID();
    const orgId = (req.headers['x-org-id'] as string) ?? 'unknown';
    const userId = (req.headers['x-user-id'] as string) ?? 'unknown';

    const history = await getSessionMessages(sessionId);
    history.push({ role: 'user', content: message });

    setSseHeaders(reply);
    reply.raw.write(`data: ${JSON.stringify({ session_id: sessionId })}\n\n`);

    let assistantResponse = '';

    try {
      await withCircuitBreaker(async () => {
        const stream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        });

        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            assistantResponse += chunk.delta.text;
            reply.raw.write(`data: ${JSON.stringify({ chunk: chunk.delta.text })}\n\n`);
          }
        }
      });
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        reply.raw.write(`data: ${JSON.stringify({ error: 'Service temporarily unavailable' })}\n\n`);
      } else {
        reply.raw.write(`data: ${JSON.stringify({ error: 'Copilot request failed' })}\n\n`);
      }
      reply.raw.end();
      return;
    }

    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();

    history.push({ role: 'assistant', content: assistantResponse });
    try {
      await saveSessionMessages(sessionId, history);
      await storeDecision(orgId, userId, message, assistantResponse);
    } catch (storeErr) {
      req.log.warn({ err: storeErr }, 'Failed to persist copilot session');
    }
  });

  app.get('/v4/ai/decisions', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = DecisionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', issues: parsed.error.issues });
    }

    const { org_id, limit, offset } = parsed.data;

    const rows = await query<AiDecision>(
      `SELECT id, org_id, user_id, query, response, created_at
       FROM ai_decisions
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [org_id, limit, offset]
    );

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ai_decisions WHERE org_id = $1`,
      [org_id]
    );

    return reply.send({
      data: rows,
      total: parseInt(countResult[0]?.count ?? '0', 10),
      limit,
      offset,
    });
  });
}
