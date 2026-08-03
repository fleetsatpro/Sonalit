// Vehicle Routes

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { VehicleService } from '../services/vehicle.service.js';
import { Pool } from 'pg';
import Joi from 'joi';

const createSchema = Joi.object({
  registration: Joi.string().required().max(50),
  type: Joi.string().valid('truck', 'trailer', 'semi_trailer', 'rigid', 'van', 'flatbed').required(),
  make: Joi.string().max(100).optional(),
  model: Joi.string().max(100).optional(),
  year: Joi.number().integer().min(1990).max(new Date().getFullYear() + 1).optional(),
  transporterId: Joi.string().uuid().optional(),
  fuelType: Joi.string().max(50).optional(),
  fuelCapacity: Joi.number().positive().optional(),
  notes: Joi.string().max(500).optional(),
});

export async function vehicleRoutes(fastify: FastifyInstance, pool: Pool) {
  const service = new VehicleService(pool);

  fastify.get('/vehicles', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page = 1, pageSize = 20, status, type, transporterId, search, sortBy = 'createdAt', sortOrder = 'desc' } = request.query as any;
      const orgId = (request as any).user?.orgId;
      const result = await service.list({ page, pageSize, status, type, transporterId, search, sortBy, sortOrder, orgId });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get('/vehicles/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).user?.orgId;
      const stats = await service.getStats(orgId);
      return reply.send({ success: true, data: stats });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get<{ Params: { id: string } }>('/vehicles/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      const vehicle = await service.getById(id, orgId);
      if (!vehicle) return reply.status(404).send({ success: false, error: 'Vehicle not found' });
      return reply.send({ success: true, data: vehicle });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post('/vehicles', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = createSchema.validate(request.body);
      if (validated.error) return reply.status(400).send({ success: false, error: validated.error.message });
      const orgId = (request as any).user?.orgId;
      const vehicle = await service.create({ ...validated.value, orgId });
      return reply.status(201).send({ success: true, data: vehicle });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/vehicles/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      const vehicle = await service.update(id, request.body as any, orgId);
      return reply.send({ success: true, data: vehicle });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/vehicles/:id/location', async (request, reply) => {
    try {
      const { id } = request.params;
      const { lat, lng } = request.body as any;
      await service.updateLocation(id, { lat, lng });
      return reply.send({ success: true, message: 'Location updated' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/vehicles/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      await service.delete(id, orgId);
      return reply.send({ success: true, message: 'Vehicle deleted' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}
