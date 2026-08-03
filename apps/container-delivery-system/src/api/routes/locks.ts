// Lock Routes

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LockService } from '../services/lock.service.js';
import { Pool } from 'pg';
import Joi from 'joi';

const createSchema = Joi.object({
  serialNumber: Joi.string().required().max(100),
  securisatId: Joi.string().required().max(100),
  installationDate: Joi.date().iso().optional(),
  notes: Joi.string().max(500).optional(),
});

const updateSchema = Joi.object({
  status: Joi.string().valid('available', 'assigned', 'in_use', 'offline', 'low_battery', 'tampered', 'faulty', 'maintenance').optional(),
  notes: Joi.string().max(500).optional().allow(null),
});

const assignSchema = Joi.object({
  shipmentId: Joi.string().uuid().required(),
  vehicleId: Joi.string().uuid().required(),
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  status: Joi.string().valid('available', 'assigned', 'in_use', 'offline', 'low_battery', 'tampered', 'faulty', 'maintenance').optional(),
  search: Joi.string().max(100).optional(),
  sortBy: Joi.string().valid('createdAt', 'serialNumber', 'status', 'batteryLevel').default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

export async function lockRoutes(fastify: FastifyInstance, pool: Pool) {
  const service = new LockService(pool);

  fastify.get('/locks', async (request: FastifyRequest, reply: FastifyReply) => {
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

  fastify.get('/locks/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).user?.orgId;
      const stats = await service.getStats(orgId);
      return reply.send({ success: true, data: stats });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get<{ Params: { id: string } }>('/locks/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      const lock = await service.getById(id, orgId);

      if (!lock) {
        return reply.status(404).send({ success: false, error: 'Lock not found' });
      }

      return reply.send({ success: true, data: lock });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get<{ Params: { id: string } }>('/locks/:id/events', async (request, reply) => {
    try {
      const { id } = request.params;
      const events = await service.getEvents(id);
      return reply.send({ success: true, data: events });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post('/locks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = createSchema.validate(request.body);
      if (validated.error) {
        return reply.status(400).send({ success: false, error: validated.error.message });
      }

      const orgId = (request as any).user?.orgId;
      const lock = await service.create({ ...validated.value, orgId });
      return reply.status(201).send({ success: true, data: lock });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/locks/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const validated = updateSchema.validate(request.body);
      if (validated.error) {
        return reply.status(400).send({ success: false, error: validated.error.message });
      }

      const orgId = (request as any).user?.orgId;
      const lock = await service.update(id, validated.value, orgId);
      return reply.send({ success: true, data: lock });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post<{ Params: { id: string } }>('/locks/:id/assign', async (request, reply) => {
    try {
      const { id } = request.params;
      const validated = assignSchema.validate(request.body);
      if (validated.error) {
        return reply.status(400).send({ success: false, error: validated.error.message });
      }

      const userId = (request as any).user?.id;
      const orgId = (request as any).user?.orgId;
      const lock = await service.assignToShipment(
        id,
        validated.value.shipmentId,
        validated.value.vehicleId,
        userId,
        orgId
      );
      return reply.send({ success: true, data: lock });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post<{ Params: { id: string } }>('/locks/:id/unassign', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = (request as any).user?.id;
      const orgId = (request as any).user?.orgId;
      const lock = await service.unassignFromShipment(id, userId, orgId);
      return reply.send({ success: true, data: lock });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post<{ Params: { id: string } }>('/locks/:id/lock', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = (request as any).user?.id;
      const result = await service.remoteLock(id, userId);
      return reply.send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post<{ Params: { id: string } }>('/locks/:id/unlock', async (request, reply) => {
    try {
      const { id } = request.params;
      const userId = (request as any).user?.id;
      const result = await service.remoteUnlock(id, userId);
      return reply.send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post<{ Params: { id: string } }>('/locks/:id/sync', async (request, reply) => {
    try {
      const { id } = request.params;
      await service.syncLock(id);
      return reply.send({ success: true, message: 'Lock synced' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post('/locks/sync-all', async (request, reply) => {
    try {
      await service.syncAllLocks();
      return reply.send({ success: true, message: 'All locks synced' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/locks/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      await service.delete(id, orgId);
      return reply.send({ success: true, message: 'Lock deleted' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}
