// Driver Service

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { Driver, PaginatedResponse } from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';

export interface CreateDriverInput {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  transporterId?: string;
  license: { number: string; type: string; expiry: Date; country: string };
  dateOfBirth?: Date;
  address?: any;
  emergencyContact?: any;
  notes?: string;
  orgId?: string;
}

export interface DriverFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  transporterId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  orgId?: string;
}

export class DriverService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(input: CreateDriverInput): Promise<Driver> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const id = uuidv4();
      const orgId = input.orgId || '00000000-0000-0000-0000-000000000001';

      const result = await client.query<any>(
        `INSERT INTO cds_drivers (
          id, org_id, employee_id, first_name, last_name, email, phone, status,
          transporter_id, license, date_of_birth, address, emergency_contact, notes,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', $8, $9, $10, $11, $12, $13, NOW(), NOW())
        RETURNING *`,
        [id, orgId, input.employeeId, input.firstName, input.lastName, input.email,
         input.phone, input.transporterId || null, JSON.stringify(input.license),
         input.dateOfBirth || null, input.address ? JSON.stringify(input.address) : null,
         input.emergencyContact ? JSON.stringify(input.emergencyContact) : null,
         input.notes || null]
      );

      await client.query('COMMIT');
      logger.info(`Driver created: ${id}`);
      return this.mapToDriver(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create driver', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string, orgId?: string): Promise<Driver | null> {
    const result = await this.pool.query<any>(
      `SELECT d.*, t.name as transporter_name
       FROM cds_drivers d
       LEFT JOIN cds_transporters t ON d.transporter_id = t.id
       WHERE d.id = $1 AND d.deleted_at IS NULL
       ${orgId ? 'AND d.org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rows.length === 0) return null;
    return this.mapToDriver(result.rows[0]);
  }

  async list(filters: DriverFilters): Promise<PaginatedResponse<Driver>> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;
    const orgId = filters.orgId || '00000000-0000-0000-0000-000000000001';

    let whereClause = 'WHERE d.deleted_at IS NULL AND d.org_id = $1';
    const params: any[] = [orgId];
    let paramIndex = 2;

    if (filters.status) {
      whereClause += ` AND d.status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters.transporterId) {
      whereClause += ` AND d.transporter_id = $${paramIndex}`;
      params.push(filters.transporterId);
      paramIndex++;
    }

    if (filters.search) {
      whereClause += ` AND (d.first_name || ' ' || d.last_name ILIKE $${paramIndex} OR d.employee_id ILIKE $${paramIndex} OR d.email ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    const sortBy = filters.sortBy || 'd.created_at';
    const sortOrder = filters.sortOrder || 'desc';

    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM cds_drivers d ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await this.pool.query<any>(
      `SELECT d.*, t.name as transporter_name
       FROM cds_drivers d
       LEFT JOIN cds_transporters t ON d.transporter_id = t.id
       ${whereClause}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    return {
      data: result.rows.map((row) => this.mapToDriver(row)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async update(id: string, updates: any, orgId?: string): Promise<Driver> {
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    const allowedFields = ['status', 'transporter_id', 'phone', 'license', 'address',
      'emergency_contact', 'photo_url', 'notes'];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${i}`);
        values.push(['license', 'address', 'emergency_contact'].includes(key) ? JSON.stringify(value) : value);
        i++;
      }
    }

    if (fields.length === 0) throw new Error('No valid fields to update');

    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await this.pool.query<any>(
      `UPDATE cds_drivers SET ${fields.join(', ')}
       WHERE id = $${i} AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $' + (i + 1) : ''}
       RETURNING *`,
      orgId ? [...values, orgId] : values
    );

    if (result.rows.length === 0) throw new Error('Driver not found');
    return this.mapToDriver(result.rows[0]);
  }

  async delete(id: string, orgId?: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE cds_drivers SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rowCount === 0) throw new Error('Driver not found');
  }

  async getStats(orgId?: string): Promise<any> {
    const orgIdParam = orgId || '00000000-0000-0000-0000-000000000001';
    
    const result = await this.pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'available') as available,
        COUNT(*) FILTER (WHERE status = 'on_trip') as on_trip,
        COUNT(*) FILTER (WHERE status = 'off_duty') as off_duty
       FROM cds_drivers WHERE deleted_at IS NULL AND org_id = $1`,
      [orgIdParam]
    );

    return result.rows[0];
  }

  private mapToDriver(row: any): Driver {
    return {
      id: row.id, orgId: row.org_id, employeeId: row.employee_id,
      firstName: row.first_name, lastName: row.last_name, email: row.email,
      phone: row.phone, status: row.status, transporterId: row.transporter_id,
      transporterName: row.transporter_name, license: row.license,
      dateOfBirth: row.date_of_birth, address: row.address,
      emergencyContact: row.emergency_contact, photoUrl: row.photo_url,
      rating: row.rating ? parseFloat(row.rating) : undefined,
      totalTrips: row.total_trips, notes: row.notes,
      createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
    };
  }
}
