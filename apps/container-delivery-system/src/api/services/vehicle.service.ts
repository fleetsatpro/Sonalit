// Vehicle Service

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { Vehicle, PaginatedResponse } from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';

export interface CreateVehicleInput {
  registration: string;
  type: 'truck' | 'trailer' | 'semi_trailer' | 'rigid' | 'van' | 'flatbed';
  make?: string;
  model?: string;
  year?: number;
  transporterId?: string;
  fuelType?: string;
  fuelCapacity?: number;
  notes?: string;
  orgId?: string;
}

export interface VehicleFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  type?: string;
  transporterId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  orgId?: string;
}

export class VehicleService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(input: CreateVehicleInput): Promise<Vehicle> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const id = uuidv4();
      const orgId = input.orgId || '00000000-0000-0000-0000-000000000001';

      const result = await client.query<any>(
        `INSERT INTO cds_vehicles (
          id, org_id, registration, type, make, model, year, status,
          transporter_id, fuel_type, fuel_capacity, notes, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', $8, $9, $10, $11, NOW(), NOW())
        RETURNING *`,
        [id, orgId, input.registration, input.type, input.make || null, input.model || null,
         input.year || null, input.transporterId || null, input.fuelType || null,
         input.fuelCapacity || null, input.notes || null]
      );

      await client.query('COMMIT');
      logger.info(`Vehicle created: ${id}`);
      return this.mapToVehicle(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create vehicle', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string, orgId?: string): Promise<Vehicle | null> {
    const result = await this.pool.query<any>(
      `SELECT v.*, t.name as transporter_name
       FROM cds_vehicles v
       LEFT JOIN cds_transporters t ON v.transporter_id = t.id
       WHERE v.id = $1 AND v.deleted_at IS NULL
       ${orgId ? 'AND v.org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rows.length === 0) return null;
    return this.mapToVehicle(result.rows[0]);
  }

  async list(filters: VehicleFilters): Promise<PaginatedResponse<Vehicle>> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;
    const orgId = filters.orgId || '00000000-0000-0000-0000-000000000001';

    let whereClause = 'WHERE v.deleted_at IS NULL AND v.org_id = $1';
    const params: any[] = [orgId];
    let paramIndex = 2;

    if (filters.status) {
      whereClause += ` AND v.status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters.type) {
      whereClause += ` AND v.type = $${paramIndex}`;
      params.push(filters.type);
      paramIndex++;
    }

    if (filters.transporterId) {
      whereClause += ` AND v.transporter_id = $${paramIndex}`;
      params.push(filters.transporterId);
      paramIndex++;
    }

    if (filters.search) {
      whereClause += ` AND (v.registration ILIKE $${paramIndex} OR v.make ILIKE $${paramIndex} OR v.model ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    const sortBy = filters.sortBy || 'v.created_at';
    const sortOrder = filters.sortOrder || 'desc';

    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM cds_vehicles v ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await this.pool.query<any>(
      `SELECT v.*, t.name as transporter_name
       FROM cds_vehicles v
       LEFT JOIN cds_transporters t ON v.transporter_id = t.id
       ${whereClause}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    return {
      data: result.rows.map((row) => this.mapToVehicle(row)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async update(id: string, updates: any, orgId?: string): Promise<Vehicle> {
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    const allowedFields = ['status', 'transporter_id', 'current_driver_id', 'current_shipment_id',
      'current_location', 'last_location_update', 'current_fuel_level', 'next_service',
      'insurance_expiry', 'road_tax_expiry', 'notes'];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${i}`);
        values.push(key === 'current_location' && value ? JSON.stringify(value) : value);
        i++;
      }
    }

    if (fields.length === 0) throw new Error('No valid fields to update');

    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await this.pool.query<any>(
      `UPDATE cds_vehicles SET ${fields.join(', ')}
       WHERE id = $${i} AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $' + (i + 1) : ''}
       RETURNING *`,
      orgId ? [...values, orgId] : values
    );

    if (result.rows.length === 0) throw new Error('Vehicle not found');
    return this.mapToVehicle(result.rows[0]);
  }

  async updateLocation(id: string, location: { lat: number; lng: number }, orgId?: string): Promise<void> {
    await this.pool.query(
      `UPDATE cds_vehicles SET current_location = $1, last_location_update = NOW(), updated_at = NOW()
       WHERE id = $2 ${orgId ? 'AND org_id = $3' : ''}`,
      [JSON.stringify(location), id, orgId].filter(Boolean)
    );

    // Record in GPS history
    await this.pool.query(
      `INSERT INTO cds_gps_history (entity_type, entity_id, lat, lng, timestamp)
       VALUES ('vehicle', $1, $2, $3, NOW())`,
      [id, location.lat, location.lng]
    );
  }

  async delete(id: string, orgId?: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE cds_vehicles SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rowCount === 0) throw new Error('Vehicle not found');
  }

  async getStats(orgId?: string): Promise<any> {
    const orgIdParam = orgId || '00000000-0000-0000-0000-000000000001';
    
    const result = await this.pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'available') as available,
        COUNT(*) FILTER (WHERE status = 'on_trip') as on_trip,
        COUNT(*) FILTER (WHERE status = 'maintenance') as maintenance,
        COUNT(*) FILTER (WHERE status = 'offline') as offline
       FROM cds_vehicles WHERE deleted_at IS NULL AND org_id = $1`,
      [orgIdParam]
    );

    return result.rows[0];
  }

  private mapToVehicle(row: any): Vehicle {
    return {
      id: row.id, orgId: row.org_id, registration: row.registration, type: row.type,
      make: row.make, model: row.model, year: row.year, status: row.status,
      transporterId: row.transporter_id, transporterName: row.transporter_name,
      currentDriverId: row.current_driver_id, currentShipmentId: row.current_shipment_id,
      currentLocation: row.current_location, lastLocationUpdate: row.last_location_update,
      fuelType: row.fuel_type, fuelCapacity: row.fuel_capacity ? parseFloat(row.fuel_capacity) : undefined,
      currentFuelLevel: row.current_fuel_level ? parseFloat(row.current_fuel_level) : undefined,
      mileage: row.mileage, nextService: row.next_service, insuranceExpiry: row.insurance_expiry,
      roadTaxExpiry: row.road_tax_expiry, notes: row.notes,
      createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
    };
  }
}
