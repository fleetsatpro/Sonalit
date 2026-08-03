// Shipment Controller
// REST API endpoints for shipment management

import { FastifyRequest, FastifyReply } from 'fastify';
import { ShipmentService, CreateShipmentInput, ShipmentFilters } from '../services/shipment.service.js';
import { createShipmentSchema, updateShipmentSchema, shipmentStatusTransitionSchema, shipmentQuerySchema } from '../validators/shipment.validator.js';
import { Pool } from 'pg';
import { AuditService } from '../services/audit.service.js';

export class ShipmentController {
  private service: ShipmentService;
  private auditService: AuditService;

  constructor(pool: Pool) {
    this.service = new ShipmentService(pool);
    this.auditService = new AuditService(pool);
  }

  async create(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const validated = createShipmentSchema.validate(request.body);
      if (validated.error) {
        return reply.status(400).send({
          success: false,
          error: validated.error.message,
        });
      }

      const input = validated.value as CreateShipmentInput;
      const userId = (request as any).user?.id;
      const orgId = (request as any).user?.orgId;

      const shipment = await this.service.create({
        ...input,
        orgId,
        userId,
      });

      await this.auditService.log({
        orgId,
        userId,
        action: 'CREATE',
        entityType: 'shipment',
        entityId: shipment.id,
        newData: shipment,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send({
        success: true,
        data: shipment,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  async getById(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      const orgId = (request as any).user?.orgId;

      const shipment = await this.service.getById(id, orgId);

      if (!shipment) {
        return reply.status(404).send({
          success: false,
          error: 'Shipment not found',
        });
      }

      return reply.send({
        success: true,
        data: shipment,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const validated = shipmentQuerySchema.validate(request.query);
      if (validated.error) {
        return reply.status(400).send({
          success: false,
          error: validated.error.message,
        });
      }

      const filters = validated.value as ShipmentFilters;
      const orgId = (request as any).user?.orgId;

      const result = await this.service.list({
        ...filters,
        orgId,
      });

      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  async update(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      const validated = updateShipmentSchema.validate(request.body);
      
      if (validated.error) {
        return reply.status(400).send({
          success: false,
          error: validated.error.message,
        });
      }

      const userId = (request as any).user?.id;
      const orgId = (request as any).user?.orgId;

      const shipment = await this.service.update(id, validated.value, userId, orgId);

      await this.auditService.log({
        orgId,
        userId,
        action: 'UPDATE',
        entityType: 'shipment',
        entityId: id,
        newData: validated.value,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({
        success: true,
        data: shipment,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  async transitionStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      const validated = shipmentStatusTransitionSchema.validate(request.body);
      
      if (validated.error) {
        return reply.status(400).send({
          success: false,
          error: validated.error.message,
        });
      }

      const userId = (request as any).user?.id;
      const orgId = (request as any).user?.orgId;

      const shipment = await this.service.transitionStatus(
        id,
        validated.value.status,
        userId,
        validated.value.notes,
        orgId
      );

      await this.auditService.log({
        orgId,
        userId,
        action: 'STATUS_CHANGE',
        entityType: 'shipment',
        entityId: id,
        newData: { status: validated.value.status, notes: validated.value.notes },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({
        success: true,
        data: shipment,
      });
    } catch (error: any) {
      return reply.status(400).send({
        success: false,
        error: error.message,
      });
    }
  }

  async addCheckpoint(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      const userId = (request as any).user?.id;

      const checkpoint = await this.service.addCheckpoint(id, request.body, userId);

      await this.auditService.log({
        orgId: (request as any).user?.orgId,
        userId,
        action: 'ADD_CHECKPOINT',
        entityType: 'shipment',
        entityId: id,
        newData: checkpoint,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.status(201).send({
        success: true,
        data: checkpoint,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  async verifyCheckpoint(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { id, checkpointId } = request.params as { id: string; checkpointId: string };
      const { verified, notes } = request.body as { verified: boolean; notes?: string };
      const userId = (request as any).user?.id;

      await this.service.verifyCheckpoint(id, checkpointId, verified, userId, notes);

      await this.auditService.log({
        orgId: (request as any).user?.orgId,
        userId,
        action: 'VERIFY_CHECKPOINT',
        entityType: 'shipment',
        entityId: id,
        newData: { checkpointId, verified, notes },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({
        success: true,
        message: 'Checkpoint verified',
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  async getTimeline(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { id } = request.params as { id: string };

      const timeline = await this.service.getTimeline(id);

      return reply.send({
        success: true,
        data: timeline,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  async delete(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      const orgId = (request as any).user?.orgId;
      const userId = (request as any).user?.id;

      await this.service.delete(id, orgId);

      await this.auditService.log({
        orgId,
        userId,
        action: 'DELETE',
        entityType: 'shipment',
        entityId: id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.send({
        success: true,
        message: 'Shipment deleted',
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }

  async getStats(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const orgId = (request as any).user?.orgId;

      const stats = await this.service.getStats(orgId);

      return reply.send({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        error: error.message,
      });
    }
  }
}
