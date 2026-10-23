import { api } from './api.js';

export type HealthCheckState = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export interface SystemHealthCheck {
  id: string;
  label: string;
  status: HealthCheckState;
  checked_at: string | null;
  detail: string;
}

export interface SystemHealthPayload {
  status: 'ok' | 'degraded' | 'error' | string;
  timestamp?: string;
  uptime_seconds?: number;
  database?: string;
  redis?: string;
  partitions_ok?: boolean | null;
  checks?: SystemHealthCheck[];
  scope?: string;
  coverage?: { scope?: string; not_monitored?: string[] };
}

export type OverallHealthState = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

const HEALTH_RESPONSE_MAX_AGE_MS = 60_000;
const HEALTH_FUTURE_CLOCK_TOLERANCE_MS = 30_000;
const VALID_CHECK_STATES: HealthCheckState[] = ['healthy', 'degraded', 'unavailable', 'unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidHealthCheck(value: unknown): value is SystemHealthCheck {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.label === 'string'
    && typeof value.detail === 'string'
    && VALID_CHECK_STATES.includes(value.status as HealthCheckState)
    && (value.checked_at === null || typeof value.checked_at === 'string');
}

export function getOverallHealthState(
  payload: SystemHealthPayload | undefined,
  requestFailed = false,
  now = Date.now(),
  maxAgeMs = HEALTH_RESPONSE_MAX_AGE_MS,
): OverallHealthState {
  const checks = payload?.checks;
  if (requestFailed || !payload || !Array.isArray(checks) || checks.length === 0) return 'unknown';
  if (typeof payload.timestamp !== 'string') return 'unknown';
  const responseTime = new Date(payload.timestamp).getTime();
  const responseAge = now - responseTime;
  if (!Number.isFinite(responseTime) || responseAge < -HEALTH_FUTURE_CLOCK_TOLERANCE_MS || responseAge > maxAgeMs) return 'unknown';
  if (checks.some(check => !check || !VALID_CHECK_STATES.includes(check.status))) return 'unknown';

  // Explicit component evidence wins over the aggregate string. This prevents
  // an inconsistent "error" envelope from turning an unknown probe into a
  // claim that an outage has been confirmed.
  if (checks.some(check => check.status === 'unavailable')) return 'unavailable';
  if (checks.some(check => check.status === 'degraded')) return 'degraded';
  if (checks.some(check => check.status === 'unknown')) return 'unknown';
  if (payload.status === 'ok' && checks.every(check => check.status === 'healthy')) return 'healthy';
  return 'unknown';
}

export async function fetchSystemHealth(): Promise<SystemHealthPayload> {
  // A 503 health response still carries useful dependency evidence. Accept the
  // HTTP status here and let the typed payload drive the visual state.
  const response = await api.get<{ data?: SystemHealthPayload } & SystemHealthPayload>(
    '/health',
    { validateStatus: () => true },
  );
  const body: unknown = response.data;
  const payload: unknown = isRecord(body) && 'data' in body && body.data
    ? body.data
    : body;
  if (
    !isRecord(payload)
    || typeof payload.status !== 'string'
    || !Array.isArray(payload.checks)
    || payload.checks.length === 0
    || !payload.checks.every(isValidHealthCheck)
  ) {
    throw new Error('Health endpoint returned an invalid payload or check ledger');
  }
  return payload as unknown as SystemHealthPayload;
}

export function formatAge(iso?: string | null, now = Date.now()): string {
  if (!iso) return 'No check recorded';
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp) || timestamp > now + 30_000) return 'Timestamp unavailable';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return seconds <= 1 ? 'just now' : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatUptime(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'Not reported';
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function checkStateLabel(state: HealthCheckState): string {
  switch (state) {
    case 'healthy': return 'Healthy';
    case 'degraded': return 'Degraded';
    case 'unavailable': return 'Unavailable';
    default: return 'Unknown';
  }
}
