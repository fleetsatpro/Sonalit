import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSystemHealth,
  formatAge,
  formatUptime,
  getOverallHealthState,
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
      checks: [...healthyPayload.checks, { ...healthyPayload.checks[0], id: 'redis', status: 'unknown' }],
    })).toBe('unknown');
  });

  it('does not turn degraded or unavailable dependencies into a healthy overall state', () => {
    expect(getOverallHealthState({
      ...healthyPayload,
      status: 'degraded',
      checks: [...healthyPayload.checks, { ...healthyPayload.checks[0], id: 'redis', status: 'degraded' }],
    }, false, TEST_NOW)).toBe('degraded');
    expect(getOverallHealthState({
      ...healthyPayload,
      status: 'error',
      checks: [...healthyPayload.checks, { ...healthyPayload.checks[0], id: 'database', status: 'unavailable' }],
    }, false, TEST_NOW)).toBe('unavailable');
    expect(getOverallHealthState({
      ...healthyPayload,
      status: 'error',
      checks: [...healthyPayload.checks, { ...healthyPayload.checks[0], id: 'redis', status: 'unknown' }],
    }, false, TEST_NOW)).toBe('unknown');
    expect(getOverallHealthState({
      ...healthyPayload,
      status: 'degraded',
      checks: [...healthyPayload.checks, { ...healthyPayload.checks[0], id: 'redis', status: 'unknown' }],
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
  });

  it('rejects malformed health responses rather than inventing an all-clear', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ status: 200, data: { data: {} } } as never);
    await expect(fetchSystemHealth()).rejects.toThrow('invalid payload');
  });

  it('formats evidence age and uptime without fabricating missing values', () => {
    expect(formatAge(null, Date.parse('2026-10-23T06:00:10.000Z'))).toBe('No check recorded');
    expect(formatAge('2026-10-23T06:00:00.000Z', Date.parse('2026-10-23T06:00:12.000Z'))).toBe('12s ago');
    expect(formatUptime(undefined)).toBe('Not reported');
    expect(formatUptime(90061)).toBe('1d 1h');
  });
});
