// SecuriSat Electronic Lock Provider
// Production implementation for SecuriSat API integration

import axios, { AxiosInstance, AxiosError } from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  LockProvider,
  LockProviderConfig,
  LockDevice,
  LockAssignment,
  LockCommandResult,
  LockHealthStatus,
  LockEvent,
  SyncResult,
  WebhookPayload,
  AuthTokens,
  registerLockProvider,
} from './base.js';

interface SecuriSatLock {
  id: string;
  serial_number: string;
  status: 'online' | 'offline' | 'low_battery' | 'tampered';
  battery_level: number;
  signal_strength: number;
  last_seen: string;
  firmware_version?: string;
  hardware_version?: string;
  latitude?: number;
  longitude?: number;
}

interface SecuriSatEvent {
  id: string;
  lock_id: string;
  event_type: string;
  timestamp: string;
  latitude?: number;
  longitude?: number;
  battery_level?: number;
  signal_strength?: number;
  metadata?: Record<string, unknown>;
}

interface SecuriSatAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface SecuriSatCommandResponse {
  success: boolean;
  lock_id: string;
  command_type: string;
  result?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}

interface SecuriSatHealthResponse {
  status: string;
  battery_level: number;
  signal_strength: number;
  last_heartbeat: string;
  gps_accuracy?: number;
  firmware_version?: string;
  uptime?: number;
  issues?: string[];
}

export class SecuriSatProvider extends LockProvider {
  private client: AxiosInstance;
  private tokenExpiry: Date | null = null;

  constructor(config: LockProviderConfig) {
    super(config);
    this.client = this.createClient();
  }

  private createClient(): AxiosInstance {
    return axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout || 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private createAuthHeader(): string {
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');
    return `Basic ${credentials}`;
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.tokens?.accessToken) {
      headers['Authorization'] = `Bearer ${this.tokens.accessToken}`;
    }

    return headers;
  }

  protected setTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
    this.tokenExpiry = new Date(Date.now() + 5 * 60 * 1000); // Refresh 5 mins before expiry
  }

  isAuthenticated(): boolean {
    if (!this.tokens) return false;
    return this.tokenExpiry ? new Date() < this.tokenExpiry : false;
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.isAuthenticated()) {
      await this.authenticate();
    }
  }

  private handleError(error: unknown): never {
    if (error instanceof AxiosError) {
      const message = error.response?.data?.message || error.message;
      const status = error.response?.status || 500;
      throw new Error(`SecuriSat API Error (${status}): ${message}`);
    }
    throw error;
  }

  // Authentication Methods
  async authenticate(): Promise<AuthTokens> {
    try {
      const response = await this.client.post<SecuriSatAuthResponse>(
        '/oauth/token',
        {
          grant_type: 'client_credentials',
        },
        {
          headers: {
            Authorization: this.createAuthHeader(),
          },
        }
      );

      const tokens: AuthTokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
      };

      this.setTokens(tokens);
      return tokens;
    } catch (error) {
      this.handleError(error);
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      const response = await this.client.post<SecuriSatAuthResponse>(
        '/oauth/token',
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        },
        {
          headers: {
            Authorization: this.createAuthHeader(),
          },
        }
      );

      const tokens: AuthTokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
      };

      this.setTokens(tokens);
      return tokens;
    } catch (error) {
      this.handleError(error);
    }
  }

  // Lock Management Methods
  async listLocks(filters?: Record<string, unknown>): Promise<LockDevice[]> {
    await this.ensureAuthenticated();

    try {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status as string);
      if (filters?.limit) params.append('limit', filters.limit as string);
      if (filters?.offset) params.append('offset', filters.offset as string);

      const response = await this.client.get<SecuriSatLock[]>(
        `/locks?${params.toString()}`,
        { headers: this.getHeaders() }
      );

      return response.data.map(this.mapLockDevice);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getLock(lockId: string): Promise<LockDevice> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.get<SecuriSatLock>(
        `/locks/${lockId}`,
        { headers: this.getHeaders() }
      );

      return this.mapLockDevice(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async assignLock(lockId: string, assignment: LockAssignment): Promise<boolean> {
    await this.ensureAuthenticated();

    try {
      await this.client.post(
        `/locks/${lockId}/assign`,
        {
          shipment_id: assignment.shipmentId,
          vehicle_id: assignment.vehicleId,
          assigned_at: assignment.assignedAt.toISOString(),
          assigned_by: assignment.assignedBy,
        },
        { headers: this.getHeaders() }
      );

      return true;
    } catch (error) {
      this.handleError(error);
    }
  }

  async unassignLock(lockId: string): Promise<boolean> {
    await this.ensureAuthenticated();

    try {
      await this.client.post(
        `/locks/${lockId}/unassign`,
        {},
        { headers: this.getHeaders() }
      );

      return true;
    } catch (error) {
      this.handleError(error);
    }
  }

  // Lock Commands
  async lock(lockId: string): Promise<LockCommandResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.post<SecuriSatCommandResponse>(
        `/locks/${lockId}/lock`,
        {},
        { headers: this.getHeaders() }
      );

      return this.mapCommandResult(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async unlock(lockId: string): Promise<LockCommandResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.post<SecuriSatCommandResponse>(
        `/locks/${lockId}/unlock`,
        {},
        { headers: this.getHeaders() }
      );

      return this.mapCommandResult(response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getStatus(lockId: string): Promise<LockHealthStatus> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.get<SecuriSatHealthResponse>(
        `/locks/${lockId}/health`,
        { headers: this.getHeaders() }
      );

      return this.mapHealthStatus(lockId, response.data);
    } catch (error) {
      this.handleError(error);
    }
  }

  // Synchronization Methods
  async syncGPS(lockId: string): Promise<SyncResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.post(
        `/locks/${lockId}/sync/gps`,
        {},
        { headers: this.getHeaders() }
      );

      return {
        lockId,
        success: true,
        lastSyncAt: new Date(),
        result: response.data,
      };
    } catch (error) {
      return {
        lockId,
        success: false,
        lastSyncAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncHeartbeat(lockId: string): Promise<SyncResult> {
    await this.ensureAuthenticated();

    try {
      await this.client.post(
        `/locks/${lockId}/sync/heartbeat`,
        {},
        { headers: this.getHeaders() }
      );

      return {
        lockId,
        success: true,
        lastSyncAt: new Date(),
      };
    } catch (error) {
      return {
        lockId,
        success: false,
        lastSyncAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncBattery(lockId: string): Promise<SyncResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.post(
        `/locks/${lockId}/sync/battery`,
        {},
        { headers: this.getHeaders() }
      );

      return {
        lockId,
        success: true,
        lastSyncAt: new Date(),
        result: response.data,
      };
    } catch (error) {
      return {
        lockId,
        success: false,
        lastSyncAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncSignal(lockId: string): Promise<SyncResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.post(
        `/locks/${lockId}/sync/signal`,
        {},
        { headers: this.getHeaders() }
      );

      return {
        lockId,
        success: true,
        lastSyncAt: new Date(),
        result: response.data,
      };
    } catch (error) {
      return {
        lockId,
        success: false,
        lastSyncAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async syncEvents(lockId: string, since?: Date): Promise<LockEvent[]> {
    await this.ensureAuthenticated();

    try {
      const params = new URLSearchParams();
      if (since) params.append('since', since.toISOString());

      const response = await this.client.get<SecuriSatEvent[]>(
        `/locks/${lockId}/events?${params.toString()}`,
        { headers: this.getHeaders() }
      );

      return response.data.map(this.mapLockEvent);
    } catch (error) {
      this.handleError(error);
    }
  }

  async syncAll(lockId: string): Promise<SyncResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.post(
        `/locks/${lockId}/sync/all`,
        {},
        { headers: this.getHeaders() }
      );

      const events = response.data.events?.map(this.mapLockEvent) || [];

      return {
        lockId,
        success: true,
        lastSyncAt: new Date(),
        events,
      };
    } catch (error) {
      return {
        lockId,
        success: false,
        lastSyncAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Webhook Methods
  async subscribeWebhooks(webhookUrl: string): Promise<boolean> {
    await this.ensureAuthenticated();

    try {
      await this.client.post(
        '/webhooks/subscribe',
        {
          url: webhookUrl,
          events: [
            'lock.locked',
            'lock.unlocked',
            'lock.tampered',
            'lock.low_battery',
            'lock.offline',
            'lock.online',
            'lock.gps_update',
            'lock.heartbeat',
          ],
        },
        { headers: this.getHeaders() }
      );

      return true;
    } catch (error) {
      this.handleError(error);
    }
  }

  async unsubscribeWebhooks(): Promise<boolean> {
    await this.ensureAuthenticated();

    try {
      await this.client.post(
        '/webhooks/unsubscribe',
        {},
        { headers: this.getHeaders() }
      );

      return true;
    } catch (error) {
      this.handleError(error);
    }
  }

  verifyWebhook(payload: string, signature: string): boolean {
    if (!this.config.webhookSecret) {
      throw new Error('Webhook secret not configured');
    }

    const expectedSignature = createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  parseWebhookPayload(payload: unknown): WebhookPayload {
    const data = payload as Record<string, unknown>;

    return {
      eventType: data.event_type as string,
      lockId: data.lock_id as string,
      timestamp: new Date(data.timestamp as string),
      data: data as Record<string, unknown>,
    };
  }

  // Health Check
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health', {
        timeout: 5000,
      });

      return response.status === 200;
    } catch {
      return false;
    }
  }

  // Private Mapping Methods
  private mapLockDevice(lock: SecuriSatLock): LockDevice {
    return {
      id: lock.id,
      serialNumber: lock.serial_number,
      status: lock.status,
      batteryLevel: lock.battery_level,
      signalStrength: lock.signal_strength,
      lastSeen: new Date(lock.last_seen),
      firmwareVersion: lock.firmware_version,
      hardwareVersion: lock.hardware_version,
      location:
        lock.latitude && lock.longitude
          ? { lat: lock.latitude, lng: lock.longitude }
          : undefined,
    };
  }

  private mapCommandResult(result: SecuriSatCommandResponse): LockCommandResult {
    return {
      success: result.success,
      lockId: result.lock_id,
      commandType: result.command_type,
      result: result.result,
      error: result.error,
      timestamp: new Date(result.timestamp),
    };
  }

  private mapHealthStatus(
    lockId: string,
    health: SecuriSatHealthResponse
  ): LockHealthStatus {
    let status: 'healthy' | 'warning' | 'critical' | 'offline' = 'healthy';

    if (health.status === 'offline') {
      status = 'offline';
    } else if (health.battery_level < 10 || health.issues?.length) {
      status = 'critical';
    } else if (health.battery_level < 20 || health.signal_strength < 30) {
      status = 'warning';
    }

    return {
      lockId,
      status,
      batteryLevel: health.battery_level,
      signalStrength: health.signal_strength,
      lastHeartbeat: new Date(health.last_heartbeat),
      gpsAccuracy: health.gps_accuracy,
      firmwareVersion: health.firmware_version,
      uptime: health.uptime,
      issues: health.issues,
    };
  }

  private mapLockEvent(event: SecuriSatEvent): LockEvent {
    return {
      id: event.id,
      lockId: event.lock_id,
      type: event.event_type,
      timestamp: new Date(event.timestamp),
      location:
        event.latitude && event.longitude
          ? { lat: event.latitude, lng: event.longitude }
          : undefined,
      batteryLevel: event.battery_level,
      signalStrength: event.signal_strength,
      metadata: event.metadata,
    };
  }
}

// Register the SecuriSat provider
registerLockProvider('securisat', (config) => new SecuriSatProvider(config));
