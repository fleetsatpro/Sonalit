// Audit Service
// Centralized audit logging

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { AuditLog } from '../../../shared/types/index.js';

export interface AuditLogInput {
  orgId: string;
  userId?: string;
  userEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO cds_audit_logs (
          id, org_id, user_id, user_email, action, entity_type, entity_id,
          old_data, new_data, ip_address, user_agent, timestamp, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)`,
        [
          uuidv4(),
          input.orgId,
          input.userId || null,
          input.userEmail || null,
          input.action,
          input.entityType,
          input.entityId || null,
          input.oldData ? JSON.stringify(input.oldData) : null,
          input.newData ? JSON.stringify(input.newData) : null,
          input.ipAddress || null,
          input.userAgent || null,
          JSON.stringify(input.metadata || {}),
        ]
      );
    } catch (error) {
      // Don't fail operations due to audit logging errors
      console.error('Failed to write audit log:', error);
    }
  }

  async getLogs(filters: {
    orgId: string;
    userId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: AuditLog[]; total: number }> {
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [filters.orgId];
    let paramIndex = 2;

    if (filters.userId) {
      whereClause += ` AND user_id = $${paramIndex}`;
      params.push(filters.userId);
      paramIndex++;
    }

    if (filters.entityType) {
      whereClause += ` AND entity_type = $${paramIndex}`;
      params.push(filters.entityType);
      paramIndex++;
    }

    if (filters.entityId) {
      whereClause += ` AND entity_id = $${paramIndex}`;
      params.push(filters.entityId);
      paramIndex++;
    }

    if (filters.action) {
      whereClause += ` AND action = $${paramIndex}`;
      params.push(filters.action);
      paramIndex++;
    }

    if (filters.dateFrom) {
      whereClause += ` AND timestamp >= $${paramIndex}`;
      params.push(filters.dateFrom);
      paramIndex++;
    }

    if (filters.dateTo) {
      whereClause += ` AND timestamp <= $${paramIndex}`;
      params.push(filters.dateTo);
      paramIndex++;
    }

    // Get total count
    const countResult = await this.pool.query(
      `SELECT COUNT(*) FROM cds_audit_logs ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const result = await this.pool.query(
      `SELECT * FROM cds_audit_logs ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    return {
      data: result.rows.map((row) => ({
        id: row.id,
        orgId: row.org_id,
        userId: row.user_id,
        userEmail: row.user_email,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        oldData: row.old_data,
        newData: row.new_data,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        timestamp: row.timestamp,
        metadata: row.metadata,
      })),
      total,
    };
  }

  async getEntityHistory(
    entityType: string,
    entityId: string,
    orgId: string
  ): Promise<AuditLog[]> {
    const result = await this.pool.query(
      `SELECT * FROM cds_audit_logs 
       WHERE entity_type = $1 AND entity_id = $2 AND org_id = $3
       ORDER BY timestamp DESC`,
      [entityType, entityId, orgId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      userEmail: row.user_email,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      oldData: row.old_data,
      newData: row.new_data,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      timestamp: row.timestamp,
      metadata: row.metadata,
    }));
  }
}
