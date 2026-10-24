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
const REQUIRED_HEALTH_CHECK_IDS = [
  'api',
  'database',
  'redis',
  'partitions-gps_logs',
  'partitions-audit_logs',
  'partitions-outbox',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidHealthCheck(value: unknown): value is SystemHealthCheck {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.label === 'string'
    && typeof value.detail === 'string'
    && VALID_CHECK_STATES.includes(value.status as HealthCheckState)
    && (value.checked_at === null || typeof value.checked_at === 'string');
}

function hasCompleteHealthLedger(value: unknown): value is SystemHealthCheck[] {
  if (!Array.isArray(value) || value.length < REQUIRED_HEALTH_CHECK_IDS.length) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isValidHealthCheck(item) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return REQUIRED_HEALTH_CHECK_IDS.every(id => ids.has(id));
}

/** A fresh envelope cannot make old component evidence current. */
export function isFreshHealthSnapshot(
  payload: SystemHealthPayload | undefined,
  now = Date.now(),
  maxAgeMs = HEALTH_RESPONSE_MAX_AGE_MS,
): boolean {
  if (!payload || typeof payload.timestamp !== 'string') return false;
  const responseTime = new Date(payload.timestamp).getTime();
  const responseAge = now - responseTime;
  return Number.isFinite(responseTime)
    && responseAge >= -HEALTH_FUTURE_CLOCK_TOLERANCE_MS
    && responseAge <= maxAgeMs;
}

export function isFreshHealthCheckTimestamp(
  checkedAt: string | null | undefined,
  now = Date.now(),
  maxAgeMs = HEALTH_RESPONSE_MAX_AGE_MS,
): boolean {
  if (typeof checkedAt !== 'string') return false;
  const checkedTime = new Date(checkedAt).getTime();
  const checkedAge = now - checkedTime;
  return Number.isFinite(checkedTime)
    && checkedAge >= -HEALTH_FUTURE_CLOCK_TOLERANCE_MS
    && checkedAge <= maxAgeMs;
}

export function healthCheckEvidenceMaxAgeMs(checkId: string, defaultMaxAgeMs = HEALTH_RESPONSE_MAX_AGE_MS): number {
  // Partition maintenance runs hourly; the backend considers a successful
  // partition check current for two hours, so the UI must use the same contract.
  return checkId.startsWith('partitions-') ? 2 * 60 * 60 * 1000 : defaultMaxAgeMs;
}

export function isFreshHealthCheck(check: SystemHealthCheck, now = Date.now(), defaultMaxAgeMs = HEALTH_RESPONSE_MAX_AGE_MS): boolean {
  return isFreshHealthCheckTimestamp(
    check.checked_at,
    now,
    healthCheckEvidenceMaxAgeMs(check.id, defaultMaxAgeMs),
  );
}

export function getOverallHealthState(
  payload: SystemHealthPayload | undefined,
  requestFailed = false,
  now = Date.now(),
  maxAgeMs = HEALTH_RESPONSE_MAX_AGE_MS,
): OverallHealthState {
  const checks = payload?.checks;
  if (requestFailed || !payload || !hasCompleteHealthLedger(checks)) return 'unknown';
  if (!isFreshHealthSnapshot(payload, now, maxAgeMs)) return 'unknown';
  // Explicit negative evidence wins over the aggregate string. A stale
  // "healthy" claim, however, cannot qualify as current health evidence.
  if (checks.some(check => check.status === 'unavailable')) return 'unavailable';
  if (checks.some(check => check.status === 'degraded')) return 'degraded';
  if (checks.some(check => check.status === 'unknown')) return 'unknown';
  if (checks.some(check => check.status === 'healthy'
    && !isFreshHealthCheck(check, now, maxAgeMs))) return 'unknown';
  if (payload.status === 'ok' && checks.every(check => check.status === 'healthy')) return 'healthy';
  return 'unknown';
}

export async function fetchSystemHealth(): Promise<SystemHealthPayload> {
  // A 503 health response still carries useful dependency evidence. Accept the
  // HTTP status here and let the typed payload drive the visual state.
  const response = await api.get<{ data?: SystemHealthPayload } & SystemHealthPayload>(
    '/health',
    // Preserve a structured 503 readiness payload, but let auth, routing and
    // server errors reach the normal Axios interceptors instead of swallowing them.
    { validateStatus: (status) => (status >= 200 && status < 300) || status === 503 },
  );
  if (!((response.status >= 200 && response.status < 300) || response.status === 503)) {
    throw new Error(`Health endpoint returned HTTP ${response.status}`);
  }
  const body: unknown = response.data;
  const payload: unknown = isRecord(body) && 'data' in body && body.data
    ? body.data
    : body;
  if (
    !isRecord(payload)
    || typeof payload.status !== 'string'
    || !hasCompleteHealthLedger(payload.checks)
  ) {
    throw new Error('Health endpoint returned an invalid payload or check ledger');
  }
  if (response.status === 503 && payload.status === 'ok') {
    throw new Error('Health endpoint returned HTTP 503 with an all-clear payload');
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
