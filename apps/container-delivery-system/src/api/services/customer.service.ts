// Customer Service

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { Customer, CustomerContact, PaginatedResponse } from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';

export interface CreateCustomerInput {
  name: string;
  code: string;
  type: 'importer' | 'exporter' | 'both';
  contacts?: CustomerContact[];
  billingAddress?: any;
  deliveryAddresses?: any[];
  taxId?: string;
  creditLimit?: number;
  paymentTerms?: number;
  notes?: string;
  tags?: string[];
  orgId?: string;
}

export interface CustomerFilters {
  page?: number;
  pageSize?: number;
  type?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  orgId?: string;
}

export class CustomerService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const id = uuidv4();
      const orgId = input.orgId || '00000000-0000-0000-0000-000000000001';

      const result = await client.query<any>(
        `INSERT INTO cds_customers (
          id, org_id, name, code, type, contacts, billing_address, delivery_addresses,
          tax_id, credit_limit, payment_terms, notes, tags, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        RETURNING *`,
        [
          id, orgId, input.name, input.code, input.type,
          JSON.stringify(input.contacts || []),
          input.billingAddress ? JSON.stringify(input.billingAddress) : null,
          JSON.stringify(input.deliveryAddresses || []),
          input.taxId || null, input.creditLimit || null, input.paymentTerms || null,
          input.notes || null, input.tags || null
        ]
      );

      await client.query('COMMIT');
      logger.info(`Customer created: ${id}`);
      return this.mapToCustomer(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create customer', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string, orgId?: string): Promise<Customer | null> {
    const result = await this.pool.query<any>(
      `SELECT * FROM cds_customers WHERE id = $1 AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rows.length === 0) return null;
    return this.mapToCustomer(result.rows[0]);
  }

  async list(filters: CustomerFilters): Promise<PaginatedResponse<Customer>> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;
    const orgId = filters.orgId || '00000000-0000-0000-0000-000000000001';

    let whereClause = 'WHERE deleted_at IS NULL AND org_id = $1';
    const params: any[] = [orgId];
    let paramIndex = 2;

    if (filters.type) {
      whereClause += ` AND type = $${paramIndex}`;
      params.push(filters.type);
      paramIndex++;
    }

    if (filters.search) {
      whereClause += ` AND (name ILIKE $${paramIndex} OR code ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    const sortBy = filters.sortBy || 'name';
    const sortOrder = filters.sortOrder || 'asc';

    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM cds_customers ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await this.pool.query<any>(
      `SELECT * FROM cds_customers ${whereClause}
       ORDER BY ${sortBy} ${sortOrder}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    return {
      data: result.rows.map((row) => this.mapToCustomer(row)),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async update(id: string, updates: any, orgId?: string): Promise<Customer> {
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (['name', 'type', 'contacts', 'billing_address', 'delivery_addresses', 'tax_id', 'credit_limit', 'payment_terms', 'notes', 'tags'].includes(key)) {
        fields.push(`${key} = $${i}`);
        values.push(Array.isArray(value) ? JSON.stringify(value) : value);
        i++;
      }
    }

    if (fields.length === 0) throw new Error('No valid fields to update');

    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await this.pool.query<any>(
      `UPDATE cds_customers SET ${fields.join(', ')}
       WHERE id = $${i} AND deleted_at IS NULL
       ${orgId ? 'AND org_id = $' + (i + 1) : ''}
       RETURNING *`,
      orgId ? [...values, orgId] : values
    );

    if (result.rows.length === 0) throw new Error('Customer not found');
    return this.mapToCustomer(result.rows[0]);
  }

  async delete(id: string, orgId?: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE cds_customers SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL ${orgId ? 'AND org_id = $2' : ''}`,
      orgId ? [id, orgId] : [id]
    );

    if (result.rowCount === 0) throw new Error('Customer not found');
  }

  private mapToCustomer(row: any): Customer {
    return {
      id: row.id, orgId: row.org_id, name: row.name, code: row.code, type: row.type,
      contacts: row.contacts || [], billingAddress: row.billing_address,
      deliveryAddresses: row.delivery_addresses || [], taxId: row.tax_id,
      creditLimit: row.credit_limit ? parseFloat(row.credit_limit) : undefined,
      paymentTerms: row.payment_terms, notes: row.notes, tags: row.tags || [],
      createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
    };
  }
}
