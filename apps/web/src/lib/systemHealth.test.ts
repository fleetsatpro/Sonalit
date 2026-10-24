import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSystemHealth,
  formatAge,
  formatUptime,
  getOverallHealthState,
  isFreshHealthCheckTimestamp,
  isFreshHealthSnapshot,
} from './systemHealth.js';

vi.mock('./api.js', () => ({
  api: { get: vi.fn() },
}));

import { api } from './api.js';

const TEST_NOW = Date.parse('2026-10-23T06:00:12.000Z');

const healthyPayload = {
  status: 'ok',
  timestamp: '2026-10-23T06:00:00.000Z',
  checks: [
    { id: 'api', label: 'API process', status: 'healthy', checked_at: '2026-10-23T06:00:00.000Z', detail: 'responded' },
    { id: 'database', label: 'PostgreSQL', status: 'healthy', checked_at: '2026-10-23T06:00:00.000Z', detail: 'query passed' },
    { id: 'redis', label: 'Redis', status: 'healthy', checked_at: '2026-10-23T06:00:00.000Z', detail: 'ping passed' },
    { id: 'partitions-gps_logs', label: 'GPS partitions', status: 'healthy', checked_at: '2026-10-23T06:00:00.000Z', detail: 'partition check passed' },
    { id: 'partitions-audit_logs', label: 'Audit partitions', status: 'healthy', checked_at: '2026-10-23T06:00:00.000Z', detail: 'partition check passed' },
    { id: 'partitions-outbox', label: 'Outbox partitions', status: 'healthy', checked_at: '2026-10-23T06:00:00.000Z', detail: 'partition check passed' },
  ],
};

describe('system health evidence contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a non-empty, fully healthy check ledger before reporting healthy', () => {
    expect(getOverallHealthState(undefined)).toBe('unknown');
    expect(getOverallHealthState({ status: 'ok' })).toBe('unknown');
    expect(getOverallHealthState(healthyPayload, false, TEST_NOW)).toBe('healthy');
    expect(getOverallHealthState({
      ...healthyPayload,
      checks: healthyPayload.checks.filter(check => check.id !== 'redis'),
    }, false, TEST_NOW)).toBe('unknown');
    expect(getOverallHealthState({
      ...healthyPayload,
      checks: [...healthyPayload.checks, { ...healthyPayload.checks[0], id: 'extra', status: 'healthy' }],
    }, false, TEST_NOW)).toBe('healthy');
    expect(getOverallHealthState({
      ...healthyPayload,
      checks: [...healthyPayload.checks, { ...healthyPayload.checks[0], status: 'degraded' }],
    }, false, TEST_NOW)).toBe('unknown');
  });

  it('does not turn degraded or unavailable dependencies into a healthy overall state', () => {
    expect(getOverallHealthState({
      ...healthyPayload,
      status: 'degraded',
      checks: healthyPayload.checks.map(check => check.id === 'redis' ? { ...check, status: 'degraded' } : check),
    }, false, TEST_NOW)).toBe('degraded');
    expect(getOverallHealthState({
      ...healthyPayload,
      status: 'error',
      checks: healthyPayload.checks.map(check => check.id === 'database' ? { ...check, status: 'unavailable' } : check),
    }, false, TEST_NOW)).toBe('unavailable');
    expect(getOverallHealthState({
      ...healthyPayload,
      status: 'error',
      checks: healthyPayload.checks.map(check => check.id === 'redis' ? { ...check, status: 'unknown' } : check),
    }, false, TEST_NOW)).toBe('unknown');
    expect(getOverallHealthState({
      ...healthyPayload,
      status: 'degraded',
      checks: healthyPayload.checks.map(check => check.id === 'redis' ? { ...check, status: 'unknown' } : check),
    }, false, TEST_NOW)).toBe('unknown');
    expect(getOverallHealthState({
      ...healthyPayload,
      timestamp: '2026-10-23T05:58:00.000Z',
    }, false, TEST_NOW)).toBe('unknown');
    expect(getOverallHealthState({
      ...healthyPayload,
      timestamp: 'not-a-timestamp',
    }, false, TEST_NOW)).toBe('unknown');
    expect(getOverallHealthState(healthyPayload, true, TEST_NOW)).toBe('unknown');
  });

  it('accepts an HTTP 503 health payload and unwraps the standard API envelope', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 503,
      data: { data: { ...healthyPayload, status: 'error' } },
    } as never);
    await expect(fetchSystemHealth()).resolves.toMatchObject({ status: 'error' });
    expect(api.get).toHaveBeenCalledWith('/health', { validateStatus: expect.any(Function) });
    const validateStatus = (vi.mocked(api.get).mock.calls[0]?.[1] as { validateStatus?: (status: number) => boolean } | undefined)?.validateStatus;
    expect(validateStatus?.(200)).toBe(true);
    expect(validateStatus?.(503)).toBe(true);
    expect(validateStatus?.(401)).toBe(false);
    expect(validateStatus?.(404)).toBe(false);
    expect(validateStatus?.(500)).toBe(false);

    // Even if a nonstandard Axios adapter resolves unexpectedly, a 404 cannot
    // masquerade as a valid health response.
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 404,
      data: healthyPayload,
    } as never);
    await expect(fetchSystemHealth()).rejects.toThrow('HTTP 404');
  });

  it('rejects a 503 response whose payload claims every core check is healthy', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 503,
      data: healthyPayload,
    } as never);
    await expect(fetchSystemHealth()).rejects.toThrow('503 with an all-clear payload');
  });

  it('rejects malformed health responses rather than inventing an all-clear', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ status: 200, data: { data: {} } } as never);
    await expect(fetchSystemHealth()).rejects.toThrow('invalid payload');
    vi.mocked(api.get).mockResolvedValueOnce({
      status: 200,
      data: { status: 'ok', timestamp: healthyPayload.timestamp, checks: [null] },
    } as never);
    await expect(fetchSystemHealth()).rejects.toThrow('invalid payload or check ledger');
  });

  it('requires fresh component timestamps before treating a fresh envelope as healthy', () => {
    const staleChecks = {
      ...healthyPayload,
      checks: healthyPayload.checks.map(check => ({
        ...check,
        checked_at: '2026-10-23T05:58:00.000Z',
      })),
    };
    expect(isFreshHealthSnapshot(staleChecks, TEST_NOW)).toBe(true);
    expect(isFreshHealthCheckTimestamp('2026-10-23T05:58:00.000Z', TEST_NOW)).toBe(false);
    expect(isFreshHealthCheckTimestamp(null, TEST_NOW)).toBe(false);
    expect(getOverallHealthState(staleChecks, false, TEST_NOW)).toBe('unknown');
    expect(getOverallHealthState({
      ...healthyPayload,
      checks: healthyPayload.checks.map(check => ({ ...check, checked_at: null })),
    }, false, TEST_NOW)).toBe('unknown');
  });

  it('formats evidence age and uptime without fabricating missing values', () => {
    expect(formatAge(null, Date.parse('2026-10-23T06:00:10.000Z'))).toBe('No check recorded');
    expect(formatAge('2026-10-23T06:00:00.000Z', Date.parse('2026-10-23T06:00:12.000Z'))).toBe('12s ago');
    expect(formatUptime(undefined)).toBe('Not reported');
    expect(formatUptime(90061)).toBe('1d 1h');
  });
});
