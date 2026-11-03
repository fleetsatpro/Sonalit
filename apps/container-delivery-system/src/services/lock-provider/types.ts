export interface LockProviderConfig {
  baseUrl: string;
  apiKey: string;
  webhookSecret?: string;
  timeout?: number;
}

export interface LockDeviceInfo {
  id: string;
  serial: string;
  firmwareVersion: string;
  hardwareVersion: string;
  batteryLevel: number;
  solarCharging: boolean;
  signalStrength: 'strong' | 'medium' | 'weak' | 'offline';
  temperature: number | null;
  lat: number | null;
  lng: number | null;
  lastHeartbeat: string;
  isLocked: boolean;
  tamperDetected: boolean;
}

export interface LockGPSData {
  lat: number;
  lng: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  accuracy: number;
  timestamp: string;
}

export interface LockEvent {
  id: string;
  lockId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface LockHealthReport {
  lockId: string;
  batteryLevel: number;
  solarCharging: boolean;
  signalStrength: string;
  firmwareVersion: string;
  temperature: number | null;
  uptime: number;
  lastCommunication: string;
  issues: string[];
}

export interface LockProvider {
  readonly name: string;
  readonly version: string;

  authenticate(config: LockProviderConfig): Promise<void>;
  refreshToken(): Promise<void>;

  listLocks(page?: number, pageSize?: number): Promise<{ locks: LockDeviceInfo[]; total: number }>;
  getLock(lockId: string): Promise<LockDeviceInfo>;

  assignLock(lockId: string, containerId: string, metadata?: Record<string, unknown>): Promise<void>;
  unassignLock(lockId: string): Promise<void>;

  lock(lockId: string, reason?: string): Promise<void>;
  unlock(lockId: string, authorizedBy: string, reason?: string): Promise<void>;

  syncGPS(lockId: string): Promise<LockGPSData>;
  syncHeartbeat(lockId: string): Promise<LockDeviceInfo>;
  syncBattery(lockId: string): Promise<{ level: number; charging: boolean }>;
  syncSignal(lockId: string): Promise<{ strength: string; rssi: number }>;
  syncEvents(lockId: string, since?: string): Promise<LockEvent[]>;

  subscribeWebhooks(callbackUrl: string, events: string[]): Promise<string>;
  acknowledgeAlerts(alertIds: string[]): Promise<void>;
  healthCheck(): Promise<LockHealthReport>;
}
