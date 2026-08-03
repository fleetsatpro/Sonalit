// Shipment Service
// Business logic for shipment management

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  Shipment,
  ShipmentStatus,
  ShipmentCheckpoint,
  ShipmentTimeline,
  PaginatedResponse,
} from '../../../shared/types/index.js';
import { SHIPMENT_STATUS_FLOW } from '../../../shared/constants/index.js';
import { logger } from '../../../shared/utils/logger.js';

export interface CreateShipmentInput {
  reference: string;
  customerId: string;
  transporterId?: string;
  origin: any;
  destination: any;
  originCoords: { lat: number; lng: number };
  destinationCoords: { lat: number; lng: number };
  expectedPickup?: Date;
  expectedDelivery?: Date;
  cargoDescription?: string;
  weight?: number;
  value?: number;
  priority?: string;
  notes?: string;
  orgId?: string;
  userId?: string;
}

export interface ShipmentFilters {
  page?: number;
  pageSize?: number;
  status?: ShipmentStatus;
  priority?: string;
  customerId?: string;
  transporterId?: string;
  containerId?: string;
  vehicleId?: string;
  driverId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  dateFrom?: Date;
  dateTo?: Date;
  orgId?: string;
}

export class ShipmentService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(input: CreateShipmentInput): Promise<Shipment> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const id = uuidv4();
      const orgId = input.orgId || '00000000-0000-0000-0000-000000000001';

      const result = await client.query<any>(
        `INSERT INTO cds_shipments (
          id, org_id, reference, customer_id, transporter_id, status, priority,
          origin, destination, origin_coords, destination_coords,
          expected_pickup, expected_delivery, cargo_description, weight, value,
          notes, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'created', $6,
          $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
        ) RETURNING *`,
        [
          id,
          orgId,
          input.reference,
          input.customerId,
          input.transporterId || null,
          input.priority || 'medium',
          JSON.stringify(input.origin),
          JSON.stringify(input.destination),
          JSON.stringify(input.originCoords),
          JSON.stringify(input.destinationCoords),
          input.expectedPickup || null,
          input.expectedDelivery || null,
          input.cargoDescription || null,
          input.weight || null,
          input.value || null,
          input.notes || null,
        ]
      );

      const shipment = this.mapToShipment(result.rows[0]);

      // Create initial timeline entry
      await this.addTimelineEntry(
        client,
        id,
        'created',
        input.userId,
        'Shipment created'
      );

      await client.query('COMMIT');

      logger.info(`Shipment created: ${id}`);
      return shipment;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create shipment', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string, orgId?: string): Promise<Shipment | null> {
    const result = await this.pool.query<any>(
      `SELECT s.*, 
        c.name as customer_name, c.code as customer_code,
        t.name as transporter_name, t.code as transporter_code,
        v.registration as vehicle_registration,
        d.first_name || ' ' || d.last_name as driver_name
       FROM cds_shipments s
       LEFT JOIN cds_customers c ON s.customer_id = c.id
       LEFT JOIN cds_transporters t ON s.transporter_id = t.id
       LEFT JOIN cds_vehicles v ON s.vehicle_id = v.id
       LEFT JOIN cds_drivers d ON s.driver_id = d.id
       WHERE s.id = $1 AND s.deleted_at IS NULL
       ${orgId ? 'AND s.org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapToShipment(result.rows[0]);
  }

  async getByReference(reference: string, orgId?: string): Promise<Shipment | null> {
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_shipments 
       WHERE reference = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [reference, orgId] : [reference]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapToShipment(result.rows[0]);
  }

  async list(filters: ShipmentFilters): Promise<PaginatedResponse<Shipment>> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;
    const orgId = filters.orgId || '00000000-0000-0000-0000-000000000001';

    let whereClause = 'WHERE s.deleted_at IS NULL AND s.org_id = $1';
    const params: any[] = [orgId];
    let paramIndex = 2;

    if (filters.status) {
      whereClause += ` AND s.status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters.priority) {
      whereClause += ` AND s.priority = $${paramIndex}`;
      params.push(filters.priority);
      paramIndex++;
    }

    if (filters.customerId) {
      whereClause += ` AND s.customer_id = $${paramIndex}`;
      params.push(filters.customerId);
      paramIndex++;
    }

    if (filters.transporterId) {
      whereClause += ` AND s.transporter_id = $${paramIndex}`;
      params.push(filters.transporterId);
      paramIndex++;
    }

    if (filters.containerId) {
      whereClause += ` AND s.container_id = $${paramIndex}`;
      params.push(filters.containerId);
      paramIndex++;
    }

    if (filters.vehicleId) {
      whereClause += ` AND s.vehicle_id = $${paramIndex}`;
      params.push(filters.vehicleId);
      paramIndex++;
    }

    if (filters.driverId) {
      whereClause += ` AND s.driver_id = $${paramIndex}`;
      params.push(filters.driverId);
      paramIndex++;
    }

    if (filters.search) {
      whereClause += ` AND (s.reference ILIKE $${paramIndex} OR s.cargo_description ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    if (filters.dateFrom) {
      whereClause += ` AND s.expected_delivery >= $${paramIndex}`;
      params.push(filters.dateFrom);
      paramIndex++;
    }

    if (filters.dateTo) {
      whereClause += ` AND s.expected_delivery <= $${paramIndex}`;
      params.push(filters.dateTo);
      paramIndex++;
    }

    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';

    // Get total count
    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM cds_shipments s ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const result = await this.pool.query<any>(
      `SELECT s.*,
        c.name as customer_name, c.code as customer_code,
        t.name as transporter_name, t.code as transporter_code
       FROM cds_shipments s
       LEFT JOIN cds_customers c ON s.customer_id = c.id
       LEFT JOIN cds_transporters t ON s.transporter_id = t.id
       ${whereClause}
       ORDER BY s.${sortBy} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    const shipments = result.rows.map((row) => this.mapToShipment(row));

    return {
      data: shipments,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async update(id: string, updates: any, userId?: string, orgId?: string): Promise<Shipment> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const setClause: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      const allowedFields = [
        'transporter_id', 'container_id', 'vehicle_id', 'driver_id', 'lock_id',
        'status', 'priority', 'expected_pickup', 'expected_delivery',
        'actual_pickup', 'actual_delivery', 'current_location', 'route_geometry',
        'estimated_arrival', 'delay_minutes', 'notes'
      ];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          setClause.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (setClause.length === 0) {
        throw new Error('No valid fields to update');
      }

      setClause.push('updated_at = NOW()');
      values.push(id);

      const result = await client.query<any>(
        `UPDATE cds_shipments SET ${setClause.join(', ')}
         WHERE id = $${paramIndex} AND deleted_at IS NULL
         ${orgId ? 'AND org_id = $' + (paramIndex + 1) : ''}
         RETURNING *`,
        orgId ? [...values, orgId] : values
      );

      if (result.rows.length === 0) {
        throw new Error('Shipment not found');
      }

      await client.query('COMMIT');

      logger.info(`Shipment updated: ${id}`);
      return this.mapToShipment(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update shipment', { error, id });
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionStatus(
    id: string,
    newStatus: ShipmentStatus,
    userId?: string,
    notes?: string,
    orgId?: string
  ): Promise<Shipment> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get current status
      const current = await client.query<any>(
        'SELECT status FROM cds_shipments WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );

      if (current.rows.length === 0) {
        throw new Error('Shipment not found');
      }

      const currentStatus = current.rows[0].status;

      // Validate transition
      const allowedTransitions = SHIPMENT_STATUS_FLOW[currentStatus] || [];
      if (!allowedTransitions.includes(newStatus)) {
        throw new Error(
          `Invalid status transition from '${currentStatus}' to '${newStatus}'`
        );
      }

      // Update status
      const result = await client.query<any>(
        `UPDATE cds_shipments SET status = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [newStatus, id]
      );

      // Add timeline entry
      await this.addTimelineEntry(
        client,
        id,
        newStatus,
        userId,
        notes || `Status changed to ${newStatus}`,
        { previousStatus: currentStatus }
      );

      // Update related entities based on status
      await this.handleStatusTransition(client, id, newStatus);

      await client.query('COMMIT');

      logger.info(`Shipment ${id} transitioned to status: ${newStatus}`);
      return this.mapToShipment(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to transition shipment status', { error, id, newStatus });
      throw error;
    } finally {
      client.release();
    }
  }

  async addCheckpoint(
    shipmentId: string,
    checkpoint: Partial<ShipmentCheckpoint>,
    userId?: string
  ): Promise<ShipmentCheckpoint> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const id = uuidv4();
      const newCheckpoint = {
        id,
        shipmentId,
        name: checkpoint.name,
        location: checkpoint.location,
        address: checkpoint.address,
        expectedArrival: checkpoint.expectedArrival,
        verified: false,
        ...checkpoint,
      };

      // Get current checkpoints
      const result = await client.query<any>(
        'SELECT checkpoints FROM cds_shipments WHERE id = $1',
        [shipmentId]
      );

      if (result.rows.length === 0) {
        throw new Error('Shipment not found');
      }

      const checkpoints = result.rows[0].checkpoints || [];
      checkpoints.push(newCheckpoint);

      // Update checkpoints
      await client.query(
        'UPDATE cds_shipments SET checkpoints = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(checkpoints), shipmentId]
      );

      // Add timeline entry
      await this.addTimelineEntry(
        client,
        shipmentId,
        result.rows[0].status,
        userId,
        `Checkpoint added: ${checkpoint.name}`
      );

      await client.query('COMMIT');

      return newCheckpoint;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to add checkpoint', { error, shipmentId });
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyCheckpoint(
    shipmentId: string,
    checkpointId: string,
    verified: boolean,
    userId?: string,
    notes?: string
  ): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get current checkpoints
      const result = await client.query<any>(
        'SELECT checkpoints FROM cds_shipments WHERE id = $1',
        [shipmentId]
      );

      if (result.rows.length === 0) {
        throw new Error('Shipment not found');
      }

      const checkpoints = result.rows[0].checkpoints || [];
      const checkpointIndex = checkpoints.findIndex((c: any) => c.id === checkpointId);

      if (checkpointIndex === -1) {
        throw new Error('Checkpoint not found');
      }

      checkpoints[checkpointIndex].verified = verified;
      checkpoints[checkpointIndex].verifiedBy = userId;
      checkpoints[checkpointIndex].verifiedAt = new Date();
      if (notes) {
        checkpoints[checkpointIndex].notes = notes;
      }

      // Update checkpoints
      await client.query(
        'UPDATE cds_shipments SET checkpoints = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(checkpoints), shipmentId]
      );

      await client.query('COMMIT');

      logger.info(`Checkpoint ${checkpointId} verified: ${verified}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to verify checkpoint', { error, shipmentId, checkpointId });
      throw error;
    } finally {
      client.release();
    }
  }

  async getTimeline(shipmentId: string): Promise<ShipmentTimeline[]> {
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_shipment_timeline 
       WHERE shipment_id = $1 
       ORDER BY timestamp DESC`,
      [shipmentId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      shipmentId: row.shipment_id,
      status: row.status,
      timestamp: row.timestamp,
      userId: row.user_id,
      notes: row.notes,
      metadata: row.metadata,
    }));
  }

  async delete(id: string, orgId?: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE cds_shipments SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rowCount === 0) {
      throw new Error('Shipment not found');
    }

    logger.info(`Shipment deleted: ${id}`);
  }

  async getStats(orgId?: string): Promise<any> {
    const orgIdParam = orgId || '00000000-0000-0000-0000-000000000001';
    
    const result = await this.pool.query<any>(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'in_transit') as in_transit,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered_today,
        COUNT(*) FILTER (WHERE delay_minutes > 0 AND status NOT IN ('delivered', 'closed', 'archived')) as delayed,
        COUNT(*) FILTER (WHERE expected_delivery < NOW() AND status NOT IN ('delivered', 'closed', 'archived')) as overdue,
        COUNT(*) as total_active
       FROM cds_shipments
       WHERE deleted_at IS NULL AND org_id = $1
       AND status NOT IN ('archived', 'cancelled')`,
      [orgIdParam]
    );

    return result.rows[0];
  }

  // Private helper methods
  private async addTimelineEntry(
    client: any,
    shipmentId: string,
    status: string,
    userId?: string,
    notes?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const id = uuidv4();
    await client.query(
      `INSERT INTO cds_shipment_timeline (id, shipment_id, status, timestamp, user_id, notes, metadata)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6)`,
      [id, shipmentId, status, userId || null, notes || null, JSON.stringify(metadata || {})]
    );
  }

  private async handleStatusTransition(
    client: any,
    shipmentId: string,
    newStatus: ShipmentStatus
  ): Promise<void> {
    switch (newStatus) {
      case 'delivered':
        await client.query(
          `UPDATE cds_shipments SET actual_delivery = NOW() WHERE id = $1`,
          [shipmentId]
        );
        break;
      case 'in_transit':
        await client.query(
          `UPDATE cds_shipments SET actual_pickup = NOW() WHERE id = $1 AND actual_pickup IS NULL`,
          [shipmentId]
        );
        break;
    }
  }

  private mapToShipment(row: any): Shipment {
    return {
      id: row.id,
      orgId: row.org_id,
      reference: row.reference,
      customerId: row.customer_id,
      transporterId: row.transporter_id,
      containerId: row.container_id,
      vehicleId: row.vehicle_id,
      driverId: row.driver_id,
      lockId: row.lock_id,
      status: row.status,
      priority: row.priority,
      origin: row.origin,
      destination: row.destination,
      originCoords: row.origin_coords,
      destinationCoords: row.destination_coords,
      expectedPickup: row.expected_pickup,
      actualPickup: row.actual_pickup,
      expectedDelivery: row.expected_delivery,
      actualDelivery: row.actual_delivery,
      cargoDescription: row.cargo_description,
      weight: row.weight ? parseFloat(row.weight) : undefined,
      value: row.value ? parseFloat(row.value) : undefined,
      checkpoints: row.checkpoints || [],
      currentLocation: row.current_location,
      routeGeometry: row.route_geometry,
      estimatedArrival: row.estimated_arrival,
      delayMinutes: row.delay_minutes,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      // Joined fields
      customerName: row.customer_name,
      customerCode: row.customer_code,
      transporterName: row.transporter_name,
      transporterCode: row.transporter_code,
      vehicleRegistration: row.vehicle_registration,
      driverName: row.driver_name,
    };
  }
}
