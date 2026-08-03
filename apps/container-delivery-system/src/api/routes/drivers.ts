// Driver Routes

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DriverService } from '../services/driver.service.js';
import { Pool } from 'pg';
import Joi from 'joi';

const createSchema = Joi.object({
  employeeId: Joi.string().required().max(50),
  firstName: Joi.string().required().max(100),
  lastName: Joi.string().required().max(100),
  email: Joi.string().email().required().max(255),
  phone: Joi.string().required().max(50),
  transporterId: Joi.string().uuid().optional(),
  license: Joi.object({
    number: Joi.string().required(),
    type: Joi.string().required(),
    expiry: Joi.date().iso().required(),
    country: Joi.string().required(),
  }).required(),
  dateOfBirth: Joi.date().iso().optional(),
  notes: Joi.string().max(500).optional(),
});

export async function driverRoutes(fastify: FastifyInstance, pool: Pool) {
  const service = new DriverService(pool);

  fastify.get('/drivers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page = 1, pageSize = 20, status, transporterId, search, sortBy = 'createdAt', sortOrder = 'desc' } = request.query as any;
      const orgId = (request as any).user?.orgId;
      const result = await service.list({ page, pageSize, status, transporterId, search, sortBy, sortOrder, orgId });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get('/drivers/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).user?.orgId;
      const stats = await service.getStats(orgId);
      return reply.send({ success: true, data: stats });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get<{ Params: { id: string } }>('/drivers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      const driver = await service.getById(id, orgId);
      if (!driver) return reply.status(404).send({ success: false, error: 'Driver not found' });
      return reply.send({ success: true, data: driver });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post('/drivers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = createSchema.validate(request.body);
      if (validated.error) return reply.status(400).send({ success: false, error: validated.error.message });
      const orgId = (request as any).user?.orgId;
      const driver = await service.create({ ...validated.value, orgId });
      return reply.status(201).send({ success: true, data: driver });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/drivers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      const driver = await service.update(id, request.body as any, orgId);
      return reply.send({ success: true, data: driver });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/drivers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      await service.delete(id, orgId);
      return reply.send({ success: true, message: 'Driver deleted' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}
