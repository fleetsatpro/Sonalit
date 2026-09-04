import { pool } from '../db.js';
import { getBreakerState } from '../lib/circuit-breaker.js';
import { redis } from '../redis.js';

import type { FastifyInstance } from 'fastify';

// Fastify plugins are declared async by convention; the signature is part
// of the plugin contract even when the body has nothing to await.
// eslint-disable-next-line @typescript-eslint/require-await
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz/live', async (_req, reply) => {
    await reply.send({ status: 'ok' });
  });

  app.get('/healthz/ready', async (_req, reply) => {
    const checks: Record<string, string> = {};

    try {
      await pool.query('SELECT 1');
      checks['db'] = 'ok';
    } catch {
      checks['db'] = 'error';
    }

    try {
      await redis.ping();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
    }

    checks['circuit_breaker'] = getBreakerState();

    const allOk = checks['db'] === 'ok' && checks['redis'] === 'ok';
    await reply.code(allOk ? 200 : 503).send({ status: allOk ? 'ok' : 'degraded', checks });
  });
}
