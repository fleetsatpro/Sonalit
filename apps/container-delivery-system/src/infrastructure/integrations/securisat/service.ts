// SecuriSat Integration Service
// Business logic layer for electronic lock operations

import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import { LockProvider, createLockProvider } from './base.js';
import { SecuriSatProvider } from './provider.js';
import { ElectronicLock, LockEvent, LockEventType, LockStatus } from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';

export interface SecurisatConfig {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret?: string;
}

export class SecuriSatService {
  private provider: LockProvider;
  private pool: Pool;
  private orgId: string;

  constructor(pool: Pool, config: SecurisatConfig, orgId: string = '00000000-0000-0000-0000-000000000001') {
    this.pool = pool;
    this.orgId = orgId;
    this.provider = createLockProvider('securisat', {
      apiUrl: config.apiUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      webhookSecret: config.webhookSecret,
    });
  }

  // Authentication
  async authenticate(): Promise<void> {
    try {
      await this.provider.authenticate();
      logger.info('SecuriSat authentication successful');
    } catch (error) {
      logger.error('SecuriSat authentication failed', { error });
      throw error;
    }
  }

  // Lock Operations
  async syncAllLocks(): Promise<void> {
    const locks = await this.fetchLocksFromProvider();
    
    for (const lockData of locks) {
      await this.upsertLock(lockData);
    }

    logger.info(`Synced ${locks.length} locks from SecuriSat`);
  }

  async syncLock(lockId: string): Promise<void> {
    const lockData = await this.provider.getLock(lockId);
    await this.upsertLock(lockData);

    // Sync events
    const lastSync = await this.getLastSyncTime(lockId);
    const events = await this.provider.syncEvents(lockId, lastSync);
    
    for (const event of events) {
      await this.recordLockEvent(lockId, event);
    }

    logger.info(`Synced lock ${lockId} with ${events.length} events`);
  }

  async remoteLock(lockId: string, userId: string): Promise<boolean> {
    const result = await this.provider.lock(lockId);
    
    await this.recordLockEvent(lockId, {
      id: uuidv4(),
      lockId,
      type: result.success ? 'lock' : 'lock_failure',
      timestamp: new Date(),
      metadata: { result, userId },
    });

    if (result.success) {
      await this.updateLockStatus(lockId, 'in_use');
    }

    return result.success;
  }

  async remoteUnlock(lockId: string, userId: string): Promise<boolean> {
    const result = await this.provider.unlock(lockId);
    
    await this.recordLockEvent(lockId, {
      id: uuidv4(),
      lockId,
      type: result.success ? 'unlock' : 'unlock_failure',
      timestamp: new Date(),
      metadata: { result, userId },
    });

    return result.success;
  }

  async assignLockToShipment(
    lockId: string,
    shipmentId: string,
    vehicleId: string,
    userId: string
  ): Promise<boolean> {
    const lock = await this.getLockById(lockId);
    
    if (!lock) {
      throw new Error(`Lock ${lockId} not found`);
    }

    const success = await this.provider.assignLock(lock.securisatId, {
      lockId: lock.securisatId,
      shipmentId,
      vehicleId,
      assignedAt: new Date(),
      assignedBy: userId,
    });

    if (success) {
      await this.updateLockStatus(lockId, 'assigned');
      await this.updateLockField(lockId, 'assigned_shipment_id', shipmentId);
      await this.updateLockField(lockId, 'assigned_vehicle_id', vehicleId);

      await this.recordLockEvent(lockId, {
        id: uuidv4(),
        lockId,
        type: 'lock',
        timestamp: new Date(),
        metadata: { action: 'assigned', shipmentId, vehicleId, userId },
      });
    }

    return success;
  }

  async unassignLock(lockId: string, userId: string): Promise<boolean> {
    const lock = await this.getLockById(lockId);
    
    if (!lock) {
      throw new Error(`Lock ${lockId} not found`);
    }

    const success = await this.provider.unassignLock(lock.securisatId);

    if (success) {
      await this.updateLockStatus(lockId, 'available');
      await this.updateLockField(lockId, 'assigned_shipment_id', null);
      await this.updateLockField(lockId, 'assigned_vehicle_id', null);

      await this.recordLockEvent(lockId, {
        id: uuidv4(),
        lockId,
        type: 'unlock',
        timestamp: new Date(),
        metadata: { action: 'unassigned', userId },
      });
    }

    return success;
  }

  // Lock Health Monitoring
  async checkLockHealth(lockId: string): Promise<void> {
    const health = await this.provider.getStatus(lockId);

    // Update battery level
    if (health.batteryLevel !== undefined) {
      await this.updateLockField(lockId, 'battery_level', health.batteryLevel);
    }

    // Update signal strength
    if (health.signalStrength !== undefined) {
      await this.updateLockField(lockId, 'signal_strength', health.signalStrength);
    }

    // Update last heartbeat
    await this.updateLockField(lockId, 'last_heartbeat', health.lastHeartbeat);

    // Update status based on health
    let newStatus: LockStatus | null = null;
    if (health.status === 'offline') {
      newStatus = 'offline';
    } else if (health.batteryLevel < 10) {
      newStatus = 'low_battery';
    } else if (health.issues?.length) {
      newStatus = 'faulty';
    }

    if (newStatus) {
      await this.updateLockStatus(lockId, newStatus);
    }

    // Generate alerts for issues
    if (health.issues?.length) {
      await this.createHealthAlerts(lockId, health);
    }
  }

  // Webhook Processing
  async processWebhookEvent(event: {
    eventType: string;
    lockId: string;
    timestamp: Date;
    data: Record<string, unknown>;
  }): Promise<void> {
    const lock = await this.getLockBySecurisatId(event.lockId);
    
    if (!lock) {
      logger.warn(`Received webhook for unknown lock: ${event.lockId}`);
      return;
    }

    const eventType = this.mapEventType(event.eventType);

    await this.recordLockEvent(lock.id, {
      id: uuidv4(),
      lockId: lock.id,
      type: eventType,
      timestamp: event.timestamp,
      location: event.data.latitude && event.data.longitude
        ? { lat: event.data.latitude as number, lng: event.data.longitude as number }
        : undefined,
      batteryLevel: event.data.battery_level as number | undefined,
      signalStrength: event.data.signal_strength as number | undefined,
      metadata: event.data,
    });

    // Update lock status based on event
    await this.handleLockEvent(lock.id, eventType, event.data);

    logger.info(`Processed webhook event: ${event.eventType} for lock ${lock.id}`);
  }

  // Health Check
  async healthCheck(): Promise<boolean> {
    return this.provider.healthCheck();
  }

  // Private Helper Methods
  private async fetchLocksFromProvider(): Promise<any[]> {
    const allLocks: any[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const locks = await this.provider.listLocks({ limit, offset });
      allLocks.push(...locks);
      
      if (locks.length < limit) break;
      offset += limit;
    }

    return allLocks;
  }

  private async upsertLock(lockData: any): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        `INSERT INTO cds_locks (
          id, org_id, serial_number, securisat_id, status,
          battery_level, signal_strength, last_heartbeat, current_location,
          diagnostics, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
        )
        ON CONFLICT (securisat_id) DO UPDATE SET
          status = EXCLUDED.status,
          battery_level = EXCLUDED.battery_level,
          signal_strength = EXCLUDED.signal_strength,
          last_heartbeat = EXCLUDED.last_heartbeat,
          current_location = EXCLUDED.current_location,
          diagnostics = EXCLUDED.diagnostics,
          updated_at = NOW()
        `,
        [
          this.orgId,
          lockData.serialNumber,
          lockData.id,
          lockData.status,
          lockData.batteryLevel,
          lockData.signalStrength,
          lockData.lastSeen,
          lockData.location ? JSON.stringify(lockData.location) : null,
          JSON.stringify({
            firmwareVersion: lockData.firmwareVersion,
            hardwareVersion: lockData.hardwareVersion,
          }),
        ]
      );

      return result.rows[0];
    } finally {
      client.release();
    }
  }

  private async getLastSyncTime(lockId: string): Promise<Date | undefined> {
    const result = await this.pool.query(
      `SELECT MAX(timestamp) as last_sync FROM cds_lock_events WHERE lock_id = $1`,
      [lockId]
    );

    return result.rows[0]?.last_sync;
  }

  private async recordLockEvent(lockId: string, event: any): Promise<void> {
    await this.pool.query(
      `INSERT INTO cds_lock_events (id, lock_id, type, timestamp, location, battery_level, signal_strength, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.id,
        lockId,
        event.type,
        event.timestamp,
        event.location ? JSON.stringify(event.location) : null,
        event.batteryLevel,
        event.signalStrength,
        JSON.stringify(event.metadata || {}),
      ]
    );
  }

  private async getLockById(lockId: string): Promise<any> {
    const result = await this.pool.query(
      `SELECT * FROM cds_locks WHERE id = $1 AND deleted_at IS NULL`,
      [lockId]
    );

    return result.rows[0];
  }

  private async getLockBySecurisatId(securisatId: string): Promise<any> {
    const result = await this.pool.query(
      `SELECT * FROM cds_locks WHERE securisat_id = $1 AND deleted_at IS NULL`,
      [securisatId]
    );

    return result.rows[0];
  }

  private async updateLockStatus(lockId: string, status: LockStatus): Promise<void> {
    await this.pool.query(
      `UPDATE cds_locks SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, lockId]
    );
  }

  private async updateLockField(
    lockId: string,
    field: string,
    value: any
  ): Promise<void> {
    await this.pool.query(
      `UPDATE cds_locks SET ${field} = $1, updated_at = NOW() WHERE id = $2`,
      [value, lockId]
    );
  }

  private async createHealthAlerts(lockId: string, health: any): Promise<void> {
    for (const issue of health.issues || []) {
      await this.pool.query(
        `INSERT INTO cds_alerts (
          id, org_id, title, message, type, severity, status, source, source_id, lock_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          uuidv4(),
          this.orgId,
          'Lock Health Issue',
          issue,
          'health_issue',
          'warning',
          'active',
          'lock',
          lockId,
          lockId,
        ]
      );
    }
  }

  private mapEventType(eventType: string): LockEventType {
    const mapping: Record<string, LockEventType> = {
      'lock.locked': 'lock',
      'lock.unlocked': 'unlock',
      'lock.tampered': 'tamper',
      'lock.low_battery': 'battery_low',
      'lock.offline': 'signal_lost',
      'lock.online': 'signal_restored',
      'lock.gps_update': 'gps_update',
      'lock.heartbeat': 'heartbeat',
    };

    return mapping[eventType] || 'heartbeat';
  }

  private async handleLockEvent(
    lockId: string,
    eventType: LockEventType,
    data: Record<string, unknown>
  ): Promise<void> {
    switch (eventType) {
      case 'lock':
        await this.updateLockField(lockId, 'status', 'in_use');
        break;
      case 'unlock':
        // Keep in use until unassigned
        break;
      case 'tamper':
        await this.updateLockStatus(lockId, 'tampered');
        await this.createAlert(lockId, 'Lock Tampered', 'Critical', 'lock');
        break;
      case 'battery_low':
        await this.updateLockStatus(lockId, 'low_battery');
        await this.createAlert(lockId, 'Low Battery', 'warning', 'lock');
        break;
      case 'battery_critical':
        await this.updateLockStatus(lockId, 'low_battery');
        await this.createAlert(lockId, 'Critical Battery', 'error', 'lock');
        break;
      case 'signal_lost':
        await this.updateLockStatus(lockId, 'offline');
        await this.createAlert(lockId, 'Lock Offline', 'warning', 'lock');
        break;
      case 'signal_restored':
        const lock = await this.getLockById(lockId);
        if (lock?.assigned_shipment_id) {
          await this.updateLockStatus(lockId, 'in_use');
        } else {
          await this.updateLockStatus(lockId, 'available');
        }
        break;
      case 'gps_update':
        if (data.latitude && data.longitude) {
          await this.pool.query(
            `UPDATE cds_locks SET current_location = $1, last_location_update = NOW(), updated_at = NOW() WHERE id = $2`,
            [JSON.stringify({ lat: data.latitude, lng: data.longitude }), lockId]
          );
        }
        break;
    }
  }

  private async createAlert(
    lockId: string,
    title: string,
    severity: string,
    source: string
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO cds_alerts (
        id, org_id, title, message, type, severity, status, source, lock_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        uuidv4(),
        this.orgId,
        title,
        `${title} detected on lock ${lockId}`,
        source,
        severity,
        'active',
        source,
        lockId,
      ]
    );
  }
}

// Export singleton instance factory
let securiSatService: SecuriSatService | null = null;

export function getSecuriSatService(pool: Pool, config: SecurisatConfig, orgId?: string): SecuriSatService {
  if (!securiSatService) {
    securiSatService = new SecuriSatService(pool, config, orgId);
  }
  return securiSatService;
}

export function resetSecuriSatService(): void {
  securiSatService = null;
}
