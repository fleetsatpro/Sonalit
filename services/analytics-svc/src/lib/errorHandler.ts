import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export function analyticsErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ZodError) {
    void reply.code(400).send({
      code: 'VALIDATION_ERROR',
      error: 'Invalid query parameters',
      issues: error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const status = error.statusCode ?? 500;
  if (status >= 500) {
    request.log.error({ err: error }, 'Analytics request failed');
    void reply.code(500).send({ code: 'INTERNAL_ERROR', error: 'Internal server error' });
    return;
  }

  void reply.code(status).send({
    code: error.code ?? 'REQUEST_ERROR',
    error: error.message,
  });
}
