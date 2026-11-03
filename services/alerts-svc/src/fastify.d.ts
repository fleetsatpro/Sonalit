export {};

declare module 'fastify' {
  interface FastifyRequest {
    user?: { sub: string; org_id: string; role: string };
  }
}
