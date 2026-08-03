// Lock Service
// Business logic for electronic lock management

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  ElectronicLock,
  LockStatus,
  LockEvent,
  PaginatedResponse,
} from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';
import { SecuriSatService } from '../../../infrastructure/integrations/securisat/service.js';

export interface CreateLockInput {
  serialNumber: string;
  securisatId: string;
  installationDate?: Date;
  notes?: string;
  orgId?: string;
}

export interface LockFilters {
  page?: number;
  pageSize?: number;
  status?: LockStatus;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  orgId?: string;
}

export interface LockCommandInput {
  lockId: string;
  command: 'lock' | 'unlock';
  userId?: string;
}

export class LockService {
  private pool: Pool;
  private securiSatService?: SecuriSatService;

  constructor(pool: Pool, securiSatService?: SecuriSatService) {
    this.pool = pool;
    this.securiSatService = securiSatService;
  }

  setSecuriSatService(service: SecuriSatService): void {
    this.securiSatService = service;
  }

  async create(input: CreateLockInput): Promise<ElectronicLock> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const id = uuidv4();
      const orgId = input.orgId || '00000000-0000-0000-0000-000000000001';

      const result = await client.query<any>(
        `INSERT INTO cds_locks (
          id, org_id, serial_number, securisat_id, status,
          battery_level, signal_strength, diagnostics,
          installation_date, notes, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'available',
          100, 100, '{}',
          $5, $6, NOW(), NOW()
        ) RETURNING *`,
        [
          id,
          orgId,
          input.serialNumber,
          input.securisatId,
          input.installationDate || null,
          input.notes || null,
        ]
      );

      await client.query('COMMIT');

      logger.info(`Lock created: ${id}`);
      return this.mapToLock(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create lock', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string, orgId?: string): Promise<ElectronicLock | null> {
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_locks WHERE id = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapToLock(result.rows[0]);
  }

  async getBySecurisatId(securisatId: string, orgId?: string): Promise<ElectronicLock | null> {
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_locks WHERE securisat_id = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [securisatId, orgId] : [securisatId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapToLock(result.rows[0]);
  }

  async list(filters: LockFilters): Promise<PaginatedResponse<ElectronicLock>> {
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

    if (filters.search) {
      whereClause += ` AND (serial_number ILIKE $${paramIndex} OR securisat_id ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';

    // Get total count
    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM cds_locks ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_locks ${whereClause}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    const locks = result.rows.map((row) => this.mapToLock(row));

    return {
      data: locks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async update(id: string, updates: any, orgId?: string): Promise<ElectronicLock> {
    const setClause: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const allowedFields = [
      'status', 'assigned_shipment_id', 'assigned_vehicle_id',
      'current_location', 'battery_level', 'signal_strength',
      'last_heartbeat', 'diagnostics', 'notes'
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
      `UPDATE cds_locks SET ${setClause.join(', ')}
       WHERE id = $${paramIndex} AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $' + (paramIndex + 1) : ''}
       RETURNING *`,
      orgId ? [...values, orgId] : values
    );

    if (result.rows.length === 0) {
      throw new Error('Lock not found');
    }

    logger.info(`Lock updated: ${id}`);
    return this.mapToLock(result.rows[0]);
  }

  async assignToShipment(
    lockId: string,
    shipmentId: string,
    vehicleId: string,
    userId?: string,
    orgId?: string
  ): Promise<ElectronicLock> {
    // If SecuriSat service is available, use it
    if (this.securiSatService) {
      await this.securiSatService.assignLockToShipment(lockId, shipmentId, vehicleId, userId || '');
    }

    // Update local database
    const lock = await this.update(lockId, {
      status: 'assigned',
      assigned_shipment_id: shipmentId,
      assigned_vehicle_id: vehicleId,
    }, orgId);

    // Record event
    await this.recordEvent(lockId, 'lock', {
      action: 'assigned',
      shipmentId,
      vehicleId,
      userId,
    });

    logger.info(`Lock ${lockId} assigned to shipment ${shipmentId}`);
    return lock;
  }

  async unassignFromShipment(lockId: string, userId?: string, orgId?: string): Promise<ElectronicLock> {
    // If SecuriSat service is available, use it
    if (this.securiSatService) {
      await this.securiSatService.unassignLock(lockId, userId || '');
    }

    // Update local database
    const lock = await this.update(lockId, {
      status: 'available',
      assigned_shipment_id: null,
      assigned_vehicle_id: null,
    }, orgId);

    // Record event
    await this.recordEvent(lockId, 'unlock', {
      action: 'unassigned',
      userId,
    });

    logger.info(`Lock ${lockId} unassigned from shipment`);
    return lock;
  }

  async remoteLock(lockId: string, userId?: string): Promise<{ success: boolean }> {
    if (!this.securiSatService) {
      throw new Error('SecuriSat service not configured');
    }

    const success = await this.securiSatService.remoteLock(lockId, userId || '');
    
    await this.recordEvent(lockId, success ? 'lock' : 'lock_failure', {
      userId,
      success,
    });

    return { success };
  }

  async remoteUnlock(lockId: string, userId?: string): Promise<{ success: boolean }> {
    if (!this.securiSatService) {
      throw new Error('SecuriSat service not configured');
    }

    const success = await this.securiSatService.remoteUnlock(lockId, userId || '');
    
    await this.recordEvent(lockId, success ? 'unlock' : 'unlock_failure', {
      userId,
      success,
    });

    return { success };
  }

  async syncLock(lockId: string): Promise<void> {
    if (!this.securiSatService) {
      throw new Error('SecuriSat service not configured');
    }

    await this.securiSatService.syncLock(lockId);
  }

  async syncAllLocks(): Promise<void> {
    if (!this.securiSatService) {
      throw new Error('SecuriSat service not configured');
    }

    await this.securiSatService.syncAllLocks();
  }

  async getEvents(lockId: string, limit: number = 100): Promise<LockEvent[]> {
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_lock_events
       WHERE lock_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [lockId, limit]
    );

    return result.rows.map((row) => this.mapToEvent(row));
  }

  async delete(id: string, orgId?: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE cds_locks SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rowCount === 0) {
      throw new Error('Lock not found');
    }

    logger.info(`Lock deleted: ${id}`);
  }

  async getStats(orgId?: string): Promise<any> {
    const orgIdParam = orgId || '00000000-0000-0000-0000-000000000001';
    
    const result = await this.pool.query<any>(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'available') as available,
        COUNT(*) FILTER (WHERE status = 'assigned') as assigned,
        COUNT(*) FILTER (WHERE status = 'in_use') as in_use,
        COUNT(*) FILTER (WHERE status = 'offline') as offline,
        COUNT(*) FILTER (WHERE status = 'low_battery') as low_battery,
        COUNT(*) FILTER (WHERE status = 'tampered') as tampered,
        AVG(battery_level)::INTEGER as avg_battery,
        AVG(signal_strength)::INTEGER as avg_signal
       FROM cds_locks
       WHERE deleted_at IS NULL AND org_id = $1`,
      [orgIdParam]
    );

    return result.rows[0];
  }

  private async recordEvent(
    lockId: string,
    type: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO cds_lock_events (id, lock_id, type, timestamp, metadata)
       VALUES ($1, $2, $3, NOW(), $4)`,
      [uuidv4(), lockId, type, JSON.stringify(metadata || {})]
    );
  }

  private mapToLock(row: any): ElectronicLock {
    return {
      id: row.id,
      orgId: row.org_id,
      serialNumber: row.serial_number,
      securisatId: row.securisat_id,
      status: row.status,
      assignedShipmentId: row.assigned_shipment_id,
      assignedVehicleId: row.assigned_vehicle_id,
      currentLocation: row.current_location,
      lastLocationUpdate: row.last_location_update,
      batteryLevel: row.battery_level,
      signalStrength: row.signal_strength,
      lastHeartbeat: row.last_heartbeat,
      diagnostics: row.diagnostics || {},
      installationDate: row.installation_date,
      lastMaintenance: row.last_maintenance,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  }

  private mapToEvent(row: any): LockEvent {
    return {
      id: row.id,
      lockId: row.lock_id,
      type: row.type as any,
      timestamp: row.timestamp,
      location: row.location,
      batteryLevel: row.battery_level,
      signalStrength: row.signal_strength,
      metadata: row.metadata,
    };
  }
}
