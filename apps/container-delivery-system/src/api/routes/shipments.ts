// Shipment Routes

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ShipmentController } from '../controllers/shipment.controller.js';
import { Pool } from 'pg';

export async function shipmentRoutes(fastify: FastifyInstance, pool: Pool) {
  const controller = new ShipmentController(pool);

  // All routes require authentication
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for now - will be added with proper JWT middleware
  });

  // List shipments
  fastify.get('/shipments', async (request: FastifyRequest, reply: FastifyReply) => {
    return controller.list(request, reply);
  });

  // Get shipment stats
  fastify.get('/shipments/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    return controller.getStats(request, reply);
  });

  // Get shipment by ID
  fastify.get<{ Params: { id: string } }>(
    '/shipments/:id',
    async (request, reply) => {
      return controller.getById(request, reply);
    }
  );

  // Create shipment
  fastify.post('/shipments', async (request: FastifyRequest, reply: FastifyReply) => {
    return controller.create(request, reply);
  });

  // Update shipment
  fastify.patch<{ Params: { id: string } }>(
    '/shipments/:id',
    async (request, reply) => {
      return controller.update(request, reply);
    }
  );

  // Transition shipment status
  fastify.post<{ Params: { id: string } }>(
    '/shipments/:id/status',
    async (request, reply) => {
      return controller.transitionStatus(request, reply);
    }
  );

  // Add checkpoint
  fastify.post<{ Params: { id: string } }>(
    '/shipments/:id/checkpoints',
    async (request, reply) => {
      return controller.addCheckpoint(request, reply);
    }
  );

  // Verify checkpoint
  fastify.patch<{ Params: { id: string; checkpointId: string } }>(
    '/shipments/:id/checkpoints/:checkpointId',
    async (request, reply) => {
      return controller.verifyCheckpoint(request, reply);
    }
  );

  // Get shipment timeline
  fastify.get<{ Params: { id: string } }>(
    '/shipments/:id/timeline',
    async (request, reply) => {
      return controller.getTimeline(request, reply);
    }
  );

  // Delete shipment
  fastify.delete<{ Params: { id: string } }>(
    '/shipments/:id',
    async (request, reply) => {
      return controller.delete(request, reply);
    }
  );
}
