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
    const result = await runSync('user-1', 'org-1', { pullEnabled: false, allowedOperationTypes: ['sjm.field_event.create'] });
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

  it('does not drain unrelated queued operations during an SJM field session', async () => {
    const sjmEntry = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'sjm.field_event.create',
      transport: 'sync',
      entityType: 'sjm_journey_event',
      entityId: 'journey-1',
      label: 'security check-in',
      priority: 1,
      payload: { event_type: 'security_check_in' },
      localSequence: 2,
      clientCreatedAt: 1_798_000_000_000,
    };
    const cdsEntry = {
      ...sjmEntry,
      id: '22222222-2222-4222-8222-222222222222',
      type: 'cds_incident.create',
      entityType: 'cds_incident',
      entityId: 'incident-1',
      label: 'CDS incident',
      localSequence: 1,
    };
    mocks.dueEntries.mockResolvedValue([cdsEntry, sjmEntry]);
    mocks.apiPost.mockImplementation(async (url: string, body: { operations?: Array<{operation_id:string;type:string}> }) => {
      if (url === '/sync/device') return { data: { device_id: 'sjm-field-device', entity_types: [], operation_types: ['sjm.field_event.create'], server_checkpoint: 0, schema_version: 1 } };
      if (url === '/sync/push') return { data: { results: [{ operation_id: sjmEntry.id, outcome: 'accepted', result: { event_id: 'event-1' } }] } };
      throw new Error('Unexpected sync request: '+url);
    });
    const { classifyPushOutcome } = await import('./retryPolicy.js');
    vi.mocked(classifyPushOutcome).mockReturnValue({
      errorClass: 'NONE',
      status: 'ACKNOWLEDGED',
      retryable: false,
      code: 'accepted',
      message: 'accepted',
    });
    const result = await runSync('user-1', 'org-1', { pullEnabled: false, allowedOperationTypes: ['sjm.field_event.create'] });
    expect(result.push).toMatchObject({ attempted: 1, accepted: 1 });
    const pushCall = mocks.apiPost.mock.calls.find(call => call[0] === '/sync/push');
    expect(pushCall?.[1]?.operations).toHaveLength(1);
    expect(pushCall?.[1]?.operations[0]).toMatchObject({ type: 'sjm.field_event.create', entity_id: 'journey-1' });
    expect(pushCall?.[1]?.operations.some((entry: {type:string}) => entry.type.startsWith('cds_'))).toBe(false);
    expect(mocks.markAcknowledged).toHaveBeenCalledWith(sjmEntry.id, { event_id: 'event-1' });
  });
});
