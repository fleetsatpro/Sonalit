import axios, { type AxiosInstance } from 'axios';
import type { LockProvider, LockProviderConfig, LockDeviceInfo, LockGPSData, LockEvent, LockHealthReport } from './types.js';

export class SecuriSatProvider implements LockProvider {
  readonly name = 'SecuriSat';
  readonly version = '2.0';

  private client: AxiosInstance | null = null;
  private config: LockProviderConfig | null = null;
  private token: string | null = null;

  async authenticate(config: LockProviderConfig): Promise<void> {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 10_000,
    });

    const { data } = await this.client.post('/auth/token', {
      apiKey: config.apiKey,
    });
    this.token = data.access_token;
    this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
  }

  async refreshToken(): Promise<void> {
    if (!this.client || !this.config) throw new Error('Not authenticated');
    const { data } = await this.client.post('/auth/refresh');
    this.token = data.access_token;
    this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
  }

  private ensureClient(): AxiosInstance {
    if (!this.client) throw new Error('SecuriSat provider not authenticated');
    return this.client;
  }

  async listLocks(page = 1, pageSize = 50): Promise<{ locks: LockDeviceInfo[]; total: number }> {
    const client = this.ensureClient();
    const { data } = await client.get('/devices', { params: { page, limit: pageSize } });
    return {
      locks: data.devices.map(this.mapDevice),
      total: data.total,
    };
  }

  async getLock(lockId: string): Promise<LockDeviceInfo> {
    const client = this.ensureClient();
    const { data } = await client.get(`/devices/${lockId}`);
    return this.mapDevice(data);
  }

  async assignLock(lockId: string, containerId: string, metadata?: Record<string, unknown>): Promise<void> {
    const client = this.ensureClient();
    await client.post(`/devices/${lockId}/assign`, { container_id: containerId, ...metadata });
  }

  async unassignLock(lockId: string): Promise<void> {
    const client = this.ensureClient();
    await client.post(`/devices/${lockId}/unassign`);
  }

  async lock(lockId: string, reason?: string): Promise<void> {
    const client = this.ensureClient();
    await client.post(`/devices/${lockId}/lock`, { reason });
  }

  async unlock(lockId: string, authorizedBy: string, reason?: string): Promise<void> {
    const client = this.ensureClient();
    await client.post(`/devices/${lockId}/unlock`, { authorized_by: authorizedBy, reason });
  }

  async syncGPS(lockId: string): Promise<LockGPSData> {
    const client = this.ensureClient();
    const { data } = await client.get(`/devices/${lockId}/gps`);
    return {
      lat: data.latitude,
      lng: data.longitude,
      altitude: data.altitude ?? null,
      speed: data.speed ?? null,
      heading: data.heading ?? null,
      accuracy: data.accuracy ?? 0,
      timestamp: data.timestamp,
    };
  }

  async syncHeartbeat(lockId: string): Promise<LockDeviceInfo> {
    const client = this.ensureClient();
    const { data } = await client.get(`/devices/${lockId}/heartbeat`);
    return this.mapDevice(data);
  }

  async syncBattery(lockId: string): Promise<{ level: number; charging: boolean }> {
    const client = this.ensureClient();
    const { data } = await client.get(`/devices/${lockId}/battery`);
    return { level: data.level, charging: data.solar_charging };
  }

  async syncSignal(lockId: string): Promise<{ strength: string; rssi: number }> {
    const client = this.ensureClient();
    const { data } = await client.get(`/devices/${lockId}/signal`);
    return { strength: data.strength, rssi: data.rssi };
  }

  async syncEvents(lockId: string, since?: string): Promise<LockEvent[]> {
    const client = this.ensureClient();
    const { data } = await client.get(`/devices/${lockId}/events`, {
      params: since ? { since } : undefined,
    });
    return data.events.map((e: Record<string, unknown>) => ({
      id: e.id as string,
      lockId,
      type: e.event_type as string,
      data: e.payload as Record<string, unknown>,
      timestamp: e.created_at as string,
    }));
  }

  async subscribeWebhooks(callbackUrl: string, events: string[]): Promise<string> {
    const client = this.ensureClient();
    const { data } = await client.post('/webhooks', {
      url: callbackUrl,
      events,
      secret: this.config?.webhookSecret,
    });
    return data.webhook_id;
  }

  async acknowledgeAlerts(alertIds: string[]): Promise<void> {
    const client = this.ensureClient();
    await client.post('/alerts/acknowledge', { alert_ids: alertIds });
  }

  async healthCheck(): Promise<LockHealthReport> {
    const client = this.ensureClient();
    const { data } = await client.get('/health');
    return {
      lockId: 'system',
      batteryLevel: 100,
      solarCharging: false,
      signalStrength: data.status === 'healthy' ? 'strong' : 'weak',
      firmwareVersion: data.version,
      temperature: null,
      uptime: data.uptime,
      lastCommunication: new Date().toISOString(),
      issues: data.issues ?? [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapDevice(raw: any): LockDeviceInfo {
    return {
      id: raw.id ?? raw.device_id,
      serial: raw.serial_number ?? raw.serial,
      firmwareVersion: raw.firmware_version ?? raw.fw_version ?? 'unknown',
      hardwareVersion: raw.hardware_version ?? 'unknown',
      batteryLevel: raw.battery_level ?? raw.battery ?? 0,
      solarCharging: raw.solar_charging ?? raw.solar ?? false,
      signalStrength: this.mapSignal(raw.signal_strength ?? raw.signal ?? 0),
      temperature: raw.temperature ?? null,
      lat: raw.latitude ?? raw.lat ?? null,
      lng: raw.longitude ?? raw.lng ?? null,
      lastHeartbeat: raw.last_heartbeat ?? raw.last_seen ?? new Date().toISOString(),
      isLocked: raw.is_locked ?? raw.locked ?? false,
      tamperDetected: raw.tamper_detected ?? raw.tamper ?? false,
    };
  }

  private mapSignal(value: number | string): 'strong' | 'medium' | 'weak' | 'offline' {
    if (typeof value === 'string') return value as 'strong' | 'medium' | 'weak' | 'offline';
    if (value >= 70) return 'strong';
    if (value >= 40) return 'medium';
    if (value > 0) return 'weak';
    return 'offline';
  }
}
