// Commander HTTP surface (spec §13).
//
// Thin by design: parse, authenticate, delegate. Every rule that matters —
// tool permissions, evidence classification, budgets, audit — lives in the
// agent and the registries, so a second entry point (a worker, a NATS
// handler) inherits them rather than reimplementing them.

import { runCommander } from '../commander/agent.js';
import { CommanderRequest } from '../commander/types.js';
import { Role, type ToolContext } from '../tools/types.js';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Identity comes from headers set by the gateway, never from the body.
 *
 * A caller that could name its own org or role in the payload could read
 * another tenant's data by asking nicely, so an unparseable identity is a
 * 401 rather than a default.
 */
function identify(req: FastifyRequest): ToolContext | null {
  const orgId = req.headers['x-org-id'];
  const userId = req.headers['x-user-id'];
  const role = Role.safeParse(req.headers['x-user-role']);

  if (typeof orgId !== 'string' || typeof userId !== 'string' || !role.success) {
    return null;
  }
  return { org_id: orgId, user_id: userId, role: role.data, request_id: '' };
}

// Fastify plugins are declared async by convention; the signature is part
// of the plugin contract even when the body has nothing to await.
// eslint-disable-next-line @typescript-eslint/require-await
export async function commanderRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v4/ai/commander', async (req: FastifyRequest, reply: FastifyReply) => {
    const identity = identify(req);
    if (!identity) {
      return reply.code(401).send({ error: 'Missing or invalid identity headers' });
    }

    const body = CommanderRequest.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: body.error.issues });
    }

    const response = await runCommander({
      message: body.data.message,
      ctx: identity,
      ...(body.data.context ? { context: body.data.context } : {}),
      ...(body.data.conversation_id ? { conversationId: body.data.conversation_id } : {}),
      // §14 — no authoriser is wired yet, so screen context is always
      // treated as unauthorised and dropped. That is the safe default:
      // trusting it would let a client confirm entities it cannot read.
      // Entity-level authorisation belongs with the services that own each
      // entity type, and is the next piece of this to build.
    });

    // 200 even for a truncated or model-unavailable run: the response is a
    // well-formed report of what happened, and `completion_reason` is how a
    // client tells a complete answer from a partial one.
    return reply.send(response);
  });
}
