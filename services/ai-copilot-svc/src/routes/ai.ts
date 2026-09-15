import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, pool } from '../db.js';
import { redis } from '../redis.js';
import { withCircuitBreaker, CircuitOpenError } from '../lib/circuit-breaker.js';
import type { AiDecision } from '../db.js';

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

async function callDecisionFabric(orgId: string, userId: string, command: string, history: SessionMessage[], authorization?: string): Promise<any> {
  if (!config.DECISION_FABRIC_URL) throw new Error('DECISION_FABRIC_URL is not configured');
  const response = await fetch(config.DECISION_FABRIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': orgId,
      'x-user-id': userId,
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ command, history }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`Decision Fabric HTTP ${response.status}`);
  return response.json();
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
    if (!body.success) return reply.code(400).send({ error: 'Invalid request', issues: body.error.issues });
    const { query: userQuery, context } = body.data;
    const orgId = (req.headers['x-org-id'] as string) ?? 'unknown';
    const userId = (req.headers['x-user-id'] as string) ?? 'unknown';
    setSseHeaders(reply);
    try {
      const result = await callDecisionFabric(orgId, userId, context ? `Context:\n${context}\n\nQuery:\n${userQuery}` : userQuery, [], req.headers.authorization as string | undefined);
      reply.raw.write(`data: ${JSON.stringify({ result })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    } catch (err) {
      req.log.error({ err }, 'Unified decision fabric query failed');
      reply.raw.write(`data: ${JSON.stringify({ error: 'Unified Copilot unavailable' })}\n\n`);
      reply.raw.end();
    }
  });

  app.post('/v4/ai/copilot', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = CopilotSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid request', issues: body.error.issues });
    const { message, session_id } = body.data;
    const sessionId = session_id ?? randomUUID();
    const orgId = (req.headers['x-org-id'] as string) ?? 'unknown';
    const userId = (req.headers['x-user-id'] as string) ?? 'unknown';
    let history: SessionMessage[] = [];
    try { history = await getSessionMessages(sessionId); } catch (err) { req.log.warn({ err }, 'Copilot session read failed; starting fresh'); }
    history.push({ role: 'user', content: message });
    setSseHeaders(reply);
    reply.raw.write(`data: ${JSON.stringify({ session_id: sessionId })}\n\n`);
    try {
      const result = await callDecisionFabric(orgId, userId, message, history.slice(-SESSION_MAX_MESSAGES), req.headers.authorization as string | undefined);
      const answer = result.answer ?? result.response ?? '';
      reply.raw.write(`data: ${JSON.stringify({ result })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ chunk: answer })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      history.push({ role: 'assistant', content: answer });
      try { await saveSessionMessages(sessionId, history); } catch (err) { req.log.warn({ err }, 'Failed to persist Copilot session'); }
      return;
    } catch (err) {
      req.log.error({ err }, 'Unified Copilot request failed');
      reply.raw.write(`data: ${JSON.stringify({ error: 'Unified Copilot unavailable' })}\n\n`);
      reply.raw.end();
    }
  });

  app.get('/v4/ai/decisions', async (req: FastifyRequest, reply: FastifyReply) => {
    const org_id = (req.headers['x-org-id'] as string | undefined)?.trim();
    if (!org_id) {
      return reply.code(401).send({ error: 'x-org-id header required' });
    }

    const parsed = DecisionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', issues: parsed.error.issues });
    }

    const { limit, offset } = parsed.data;

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
