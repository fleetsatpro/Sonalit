// Lock Provider Interface
// Provider-based architecture for electronic lock integrations

import { GeoPoint } from '../../../shared/types/index.js';

export interface LockDevice {
  id: string;
  serialNumber: string;
  status: string;
  batteryLevel: number;
  signalStrength: number;
  lastSeen: Date;
  firmwareVersion?: string;
  hardwareVersion?: string;
  location?: GeoPoint;
}

export interface LockAssignment {
  lockId: string;
  shipmentId?: string;
  vehicleId?: string;
  assignedAt: Date;
  assignedBy: string;
}

export interface LockCommand {
  type: 'lock' | 'unlock' | 'status' | 'sync';
  lockId: string;
  params?: Record<string, unknown>;
}

export interface LockCommandResult {
  success: boolean;
  lockId: string;
  commandType: string;
  result?: Record<string, unknown>;
  error?: string;
  timestamp: Date;
}

export interface LockHealthStatus {
  lockId: string;
  status: 'healthy' | 'warning' | 'critical' | 'offline';
  batteryLevel: number;
  signalStrength: number;
  lastHeartbeat: Date;
  gpsAccuracy?: number;
  firmwareVersion?: string;
  uptime?: number;
  issues?: string[];
}

export interface LockEvent {
  id: string;
  lockId: string;
  type: string;
  timestamp: Date;
  location?: GeoPoint;
  batteryLevel?: number;
  signalStrength?: number;
  metadata?: Record<string, unknown>;
}

export interface WebhookPayload {
  eventType: string;
  lockId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface SyncResult {
  lockId: string;
  success: boolean;
  lastSyncAt: Date;
  events?: LockEvent[];
  error?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface LockProviderConfig {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret?: string;
  timeout?: number;
  retries?: number;
}

export abstract class LockProvider {
  protected config: LockProviderConfig;
  protected tokens?: AuthTokens;

  constructor(config: LockProviderConfig) {
    this.config = config;
  }

  // Authentication
  abstract authenticate(): Promise<AuthTokens>;
  abstract refreshToken(refreshToken: string): Promise<AuthTokens>;
  abstract isAuthenticated(): boolean;
  protected abstract setTokens(tokens: AuthTokens): void;

  // Lock Management
  abstract listLocks(filters?: Record<string, unknown>): Promise<LockDevice[]>;
  abstract getLock(lockId: string): Promise<LockDevice>;
  abstract assignLock(lockId: string, assignment: LockAssignment): Promise<boolean>;
  abstract unassignLock(lockId: string): Promise<boolean>;

  // Lock Commands
  abstract lock(lockId: string): Promise<LockCommandResult>;
  abstract unlock(lockId: string): Promise<LockCommandResult>;
  abstract getStatus(lockId: string): Promise<LockHealthStatus>;

  // Synchronization
  abstract syncGPS(lockId: string): Promise<SyncResult>;
  abstract syncHeartbeat(lockId: string): Promise<SyncResult>;
  abstract syncBattery(lockId: string): Promise<SyncResult>;
  abstract syncSignal(lockId: string): Promise<SyncResult>;
  abstract syncEvents(lockId: string, since?: Date): Promise<LockEvent[]>;
  abstract syncAll(lockId: string): Promise<SyncResult>;

  // Webhooks
  abstract subscribeWebhooks(webhookUrl: string): Promise<boolean>;
  abstract unsubscribeWebhooks(): Promise<boolean>;
  abstract verifyWebhook(payload: string, signature: string): boolean;
  abstract parseWebhookPayload(payload: unknown): WebhookPayload;

  // Health
  abstract healthCheck(): Promise<boolean>;

  // Utility
  protected abstract getHeaders(): Record<string, string>;
  protected abstract handleError(error: unknown): never;
}

// Factory function type
export type LockProviderFactory = (config: LockProviderConfig) => LockProvider;

// Provider registry
export const lockProviderRegistry: Map<string, LockProviderFactory> = new Map();

export function registerLockProvider(name: string, factory: LockProviderFactory): void {
  lockProviderRegistry.set(name.toLowerCase(), factory);
}

export function createLockProvider(
  name: string,
  config: LockProviderConfig
): LockProvider {
  const factory = lockProviderRegistry.get(name.toLowerCase());
  if (!factory) {
    throw new Error(`Unknown lock provider: ${name}`);
  }
  return factory(config);
}
