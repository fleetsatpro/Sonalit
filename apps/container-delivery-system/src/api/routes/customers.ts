// Customer Routes

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CustomerService } from '../services/customer.service.js';
import { Pool } from 'pg';
import Joi from 'joi';

const createSchema = Joi.object({
  name: Joi.string().required().max(255),
  code: Joi.string().required().max(50),
  type: Joi.string().valid('importer', 'exporter', 'both').required(),
  contacts: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone: Joi.string().required(),
    role: Joi.string().optional(),
  })).optional(),
  billingAddress: Joi.object({
    street: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    country: Joi.string().optional(),
    postalCode: Joi.string().optional(),
  }).optional(),
  deliveryAddresses: Joi.array().items(Joi.object({
    street: Joi.string().optional(),
    city: Joi.string().required(),
    state: Joi.string().optional(),
    country: Joi.string().required(),
    postalCode: Joi.string().optional(),
  })).optional(),
  taxId: Joi.string().max(100).optional(),
  creditLimit: Joi.number().positive().optional(),
  paymentTerms: Joi.number().integer().positive().optional(),
  notes: Joi.string().max(1000).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
});

export async function customerRoutes(fastify: FastifyInstance, pool: Pool) {
  const service = new CustomerService(pool);

  fastify.get('/customers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page = 1, pageSize = 20, type, search, sortBy = 'name', sortOrder = 'asc' } = request.query as any;
      const orgId = (request as any).user?.orgId;
      const result = await service.list({ page, pageSize, type, search, sortBy, sortOrder, orgId });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.get<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      const customer = await service.getById(id, orgId);
      if (!customer) return reply.status(404).send({ success: false, error: 'Customer not found' });
      return reply.send({ success: true, data: customer });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.post('/customers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = createSchema.validate(request.body);
      if (validated.error) return reply.status(400).send({ success: false, error: validated.error.message });
      const orgId = (request as any).user?.orgId;
      const customer = await service.create({ ...validated.value, orgId });
      return reply.status(201).send({ success: true, data: customer });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.patch<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      const customer = await service.update(id, request.body as any, orgId);
      return reply.send({ success: true, data: customer });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const orgId = (request as any).user?.orgId;
      await service.delete(id, orgId);
      return reply.send({ success: true, message: 'Customer deleted' });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}
