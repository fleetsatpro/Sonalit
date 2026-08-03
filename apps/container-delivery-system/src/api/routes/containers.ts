// Container Routes

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ContainerService } from '../services/container.service.js';
import { Pool } from 'pg';
import Joi from 'joi';

const createSchema = Joi.object({
  containerNumber: Joi.string().required().max(20),
  isoCode: Joi.string().required().max(10),
  type: Joi.string().valid('20ft', '40ft', '40ft_hc', '45ft', '20ft_rf', '40ft_rf', '20ft_ot', '40ft_ot', '20ft_flat', '40ft_flat').required(),
  ownerId: Joi.string().uuid().optional(),
  tareWeight: Joi.number().positive().optional(),
  maxPayload: Joi.number().positive().optional(),
  notes: Joi.string().max(500).optional(),
});

const updateSchema = Joi.object({
  status: Joi.string().valid('available', 'reserved', 'in_use', 'in_transit', 'at_port', 'at_warehouse', 'at_customer', 'maintenance', 'damaged', 'retired').optional(),
  ownerId: Joi.string().uuid().optional().allow(null),
  tareWeight: Joi.number().positive().optional(),
  maxPayload: Joi.number().positive().optional(),
  currentShipmentId: Joi.string().uuid().optional().allow(null),
  currentVehicleId: Joi.string().uuid().optional().allow(null),
  lastInspection: Joi.date().iso().optional().allow(null),
  nextInspection: Joi.date().iso().optional().allow(null),
  notes: Joi.string().max(500).optional().allow(null),
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('available', 'reserved', 'in_use', 'in_transit', 'at_port', 'at_warehouse', 'at_customer', 'maintenance', 'damaged', 'retired').optional(),
  type: Joi.string().valid('20ft', '40ft', '40ft_hc', '45ft', '20ft_rf', '40ft_rf', '20ft_ot', '40ft_ot', '20ft_flat', '40ft_flat').optional(),
  search: Joi.string().max(100).optional(),
  sortBy: Joi.string().valid('createdAt', 'containerNumber', 'status').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export async function containerRoutes(fastify: FastifyInstance, pool: Pool) {
  const service = new ContainerService(pool);

  fastify.get('/containers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = querySchema.validate(request.query);
      if (validated.error) {
        return reply.status(400).send({ success: false, error: validated.error.message });
      }

      const orgId = (request as any).user?.orgId;
      const result = await service.list({ ...validated.value, orgId });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get('/containers/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).user?.orgId;
      const stats = await service.getStats(orgId);
      return reply.send({ success: true, data: stats });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get<{ Params: { id: string } }>('/containers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      const container = await service.getById(id, orgId);

      if (!container) {
        return reply.status(404).send({ success: false, error: 'Container not found' });
      }

      return reply.send({ success: true, data: container });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post('/containers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = createSchema.validate(request.body);
      if (validated.error) {
        return reply.status(400).send({ success: false, error: validated.error.message });
      }

      const orgId = (request as any).user?.orgId;
      const container = await service.create({ ...validated.value, orgId });
      return reply.status(201).send({ success: true, data: container });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/containers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const validated = updateSchema.validate(request.body);
      if (validated.error) {
        return reply.status(400).send({ success: false, error: validated.error.message });
      }

      const orgId = (request as any).user?.orgId;
      const container = await service.update(id, validated.value, orgId);
      return reply.send({ success: true, data: container });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/containers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      await service.delete(id, orgId);
      return reply.send({ success: true, message: 'Container deleted' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}
