import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
  recoverInFlight: vi.fn(async () => 0),
  dueEntries: vi.fn(async () => []),
  counts: vi.fn(async () => ({ pending: 0, syncing: 0, acknowledged: 0, failedRetryable: 0, failedPermanent: 0, conflict: 0, oldestPendingAgeMs: null })),
  markAcknowledged: vi.fn(),
  markFailure: vi.fn(),
  markSyncing: vi.fn(),
  beginSync: vi.fn(() => vi.fn()),
  isDegraded: vi.fn(() => false),
  isReachable: vi.fn(() => true),
  reportRequestOutcome: vi.fn(),
  reportSyncSuccess: vi.fn(),
  getDeviceId: vi.fn(() => 'sjm-field-device'),
  isEnabled: vi.fn(() => true),
}));

vi.mock('../api.js', () => ({ api: { post: mocks.apiPost, get: mocks.apiGet } }));
vi.mock('./chaos.js', () => ({ CHAOS: { enabled: false }, chaosDelay: vi.fn(), chaosSyncShouldFail: vi.fn(() => false) }));
vi.mock('./connectivity.js', () => ({
  beginSync: mocks.beginSync,
  isDegraded: mocks.isDegraded,
  isReachable: mocks.isReachable,
  reportRequestOutcome: mocks.reportRequestOutcome,
  reportSyncSuccess: mocks.reportSyncSuccess,
}));
vi.mock('./db.js', () => ({ db: { sync_meta: { get: vi.fn(), put: vi.fn() }, entities: { get: vi.fn(), put: vi.fn(), update: vi.fn(), delete: vi.fn() } } }));
vi.mock('./device.js', () => ({ getDeviceId: mocks.getDeviceId }));
vi.mock('./flags.js', () => ({ isEnabled: mocks.isEnabled }));
vi.mock('./outbox.js', () => ({
  counts: mocks.counts,
  dueEntries: mocks.dueEntries,
  markAcknowledged: mocks.markAcknowledged,
  markFailure: mocks.markFailure,
  markSyncing: mocks.markSyncing,
  recoverInFlight: mocks.recoverInFlight,
}));
vi.mock('./retryPolicy.js', () => ({ classifyHttp: vi.fn(), classifyPushOutcome: vi.fn() }));

import { _resetEngine, runSync } from './syncEngine.js';

describe('SJM field push-only sync mode', () => {
  beforeEach(() => {
    _resetEngine();
    mocks.apiPost.mockReset().mockResolvedValue({
      data: { device_id: 'sjm-field-device', entity_types: [], operation_types: ['sjm.field_event.create'], server_checkpoint: 0, schema_version: 1 },
    });
    mocks.apiGet.mockReset();
    mocks.recoverInFlight.mockClear();
    mocks.dueEntries.mockReset().mockResolvedValue([]);
    mocks.reportSyncSuccess.mockClear();
  });

  it('revalidates the device and pushes its own queue without pulling CDS or other mirrored records', async () => {
    const result = await runSync('user-1', 'org-1', { pullEnabled: false });
    expect(result.blocked).toBeNull();
    expect(result.error).toBeNull();
    expect(result.push).toMatchObject({ attempted: 0, accepted: 0 });
    expect(result.pull).toBeNull();
    expect(mocks.apiPost).toHaveBeenCalledWith('/sync/device', {}, expect.objectContaining({
      headers: expect.objectContaining({ 'x-sync-device': 'sjm-field-device' }),
    }));
    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(mocks.reportSyncSuccess).toHaveBeenCalledTimes(1);
  });
});
