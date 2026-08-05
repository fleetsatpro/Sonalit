// Container Service
// Business logic for container management

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  Container,
  ContainerType,
  ContainerStatus,
  PaginatedResponse,
} from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';
import { CONTAINER_ISO_CODES } from '../../../shared/constants/index.js';

export interface CreateContainerInput {
  containerNumber: string;
  isoCode: string;
  type: ContainerType;
  ownerId?: string;
  tareWeight?: number;
  maxPayload?: number;
  length?: number;
  width?: number;
  height?: number;
  notes?: string;
  orgId?: string;
}

export interface ContainerFilters {
  page?: number;
  pageSize?: number;
  status?: ContainerStatus;
  type?: ContainerType;
  ownerId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  orgId?: string;
}

export class ContainerService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(input: CreateContainerInput): Promise<Container> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get ISO dimensions if not provided
      let dimensions = CONTAINER_ISO_CODES[input.isoCode];
      if (!dimensions && input.length && input.width && input.height) {
        dimensions = { length: input.length, width: input.width, height: input.height };
      }

      const id = uuidv4();
      const orgId = input.orgId || '00000000-0000-0000-0000-000000000001';

      const result = await client.query<any>(
        `INSERT INTO cds_containers (
          id, org_id, container_number, iso_code, type, status,
          owner_id, tare_weight, max_payload, length, width, height, volume,
          notes, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'available',
          $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
        ) RETURNING *`,
        [
          id,
          orgId,
          input.containerNumber,
          input.isoCode,
          input.type,
          input.ownerId || null,
          input.tareWeight || 0,
          input.maxPayload || 0,
          dimensions?.length || input.length || 0,
          dimensions?.width || input.width || 0,
          dimensions?.height || input.height || 0,
          dimensions ? dimensions.length * dimensions.width * dimensions.height : 0,
          input.notes || null,
        ]
      );

      await client.query('COMMIT');

      logger.info(`Container created: ${id}`);
      return this.mapToContainer(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create container', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string, orgId?: string): Promise<Container | null> {
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_containers WHERE id = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapToContainer(result.rows[0]);
  }

  async getByNumber(containerNumber: string, orgId?: string): Promise<Container | null> {
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_containers WHERE container_number = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [containerNumber, orgId] : [containerNumber]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapToContainer(result.rows[0]);
  }

  async list(filters: ContainerFilters): Promise<PaginatedResponse<Container>> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;
    const orgId = filters.orgId || '00000000-0000-0000-0000-000000000001';

    let whereClause = 'WHERE deleted_at IS NULL AND org_id = $1';
    const params: any[] = [orgId];
    let paramIndex = 2;

    if (filters.status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters.type) {
      whereClause += ` AND type = $${paramIndex}`;
      params.push(filters.type);
      paramIndex++;
    }

    if (filters.ownerId) {
      whereClause += ` AND owner_id = $${paramIndex}`;
      params.push(filters.ownerId);
      paramIndex++;
    }

    if (filters.search) {
      whereClause += ` AND (container_number ILIKE $${paramIndex} OR iso_code ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';

    // Get total count
    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM cds_containers ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_containers ${whereClause}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    const containers = result.rows.map((row) => this.mapToContainer(row));

    return {
      data: containers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async update(id: string, updates: any, orgId?: string): Promise<Container> {
    const setClause: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const allowedFields = [
      'status', 'owner_id', 'tare_weight', 'max_payload',
      'length', 'width', 'height', 'volume', 'current_shipment_id',
      'current_vehicle_id', 'current_location', 'last_inspection',
      'next_inspection', 'notes'
    ];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined) {
        setClause.push(`${key} = $${paramIndex}`);
        values.push(key === 'current_location' ? JSON.stringify(value) : value);
        paramIndex++;
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    setClause.push('updated_at = NOW()');
    values.push(id);

    const result = await this.pool.query<any>(
      `UPDATE cds_containers SET ${setClause.join(', ')}
       WHERE id = $${paramIndex} AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $' + (paramIndex + 1) : ''}
       RETURNING *`,
      orgId ? [...values, orgId] : values
    );

    if (result.rows.length === 0) {
      throw new Error('Container not found');
    }

    logger.info(`Container updated: ${id}`);
    return this.mapToContainer(result.rows[0]);
  }

  async assignToShipment(
    containerId: string,
    shipmentId: string,
    orgId?: string
  ): Promise<Container> {
    return this.update(containerId, {
      status: 'in_use',
      current_shipment_id: shipmentId,
    }, orgId);
  }

  async releaseFromShipment(containerId: string, orgId?: string): Promise<Container> {
    return this.update(containerId, {
      status: 'available',
      current_shipment_id: null,
      current_vehicle_id: null,
      current_location: null,
    }, orgId);
  }

  async delete(id: string, orgId?: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE cds_containers SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rowCount === 0) {
      throw new Error('Container not found');
    }

    logger.info(`Container deleted: ${id}`);
  }

  async getStats(orgId?: string): Promise<any> {
    const orgIdParam = orgId || '00000000-0000-0000-0000-000000000001';
    
    const result = await this.pool.query<any>(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'available') as available,
        COUNT(*) FILTER (WHERE status = 'in_use') as in_use,
        COUNT(*) FILTER (WHERE status = 'in_transit') as in_transit,
        COUNT(*) FILTER (WHERE status = 'maintenance') as maintenance,
        COUNT(*) FILTER (WHERE status = 'damaged') as damaged
       FROM cds_containers
       WHERE deleted_at IS NULL AND org_id = $1`,
      [orgIdParam]
    );

    return result.rows[0];
  }

  private mapToContainer(row: any): Container {
    return {
      id: row.id,
      orgId: row.org_id,
      containerNumber: row.container_number,
      isoCode: row.iso_code,
      type: row.type,
      status: row.status,
      ownerId: row.owner_id,
      tareWeight: row.tare_weight ? parseFloat(row.tare_weight) : undefined,
      maxPayload: row.max_payload ? parseFloat(row.max_payload) : undefined,
      length: row.length ? parseFloat(row.length) : undefined,
      width: row.width ? parseFloat(row.width) : undefined,
      height: row.height ? parseFloat(row.height) : undefined,
      volume: row.volume ? parseFloat(row.volume) : undefined,
      currentShipmentId: row.current_shipment_id,
      currentVehicleId: row.current_vehicle_id,
      currentLocation: row.current_location,
      lastInspection: row.last_inspection,
      nextInspection: row.next_inspection,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }
}
