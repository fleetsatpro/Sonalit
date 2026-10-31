import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
  recoverInFlight: vi.fn(async () => 0),
  dueEntries: vi.fn(async () => []),
  sjmDecrypt: vi.fn(async () => ({ journey_id: '33333333-3333-4333-8333-333333333333', event_type: 'security_check_in', note: null })),
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
vi.mock('./sjmFieldCrypto.js', () => ({ SJM_FIELD_EVENT_OPERATION: 'sjm.field_event.create', decryptSjmFieldPayload: mocks.sjmDecrypt }));

import { _resetEngine, push, runSync } from './syncEngine.js';

describe('SJM field push-only sync mode', () => {
  beforeEach(() => {
    _resetEngine();
    mocks.apiPost.mockReset().mockResolvedValue({
      data: { device_id: 'sjm-field-device', entity_types: [], operation_types: ['sjm.field_event.create'], server_checkpoint: 0, schema_version: 1 },
    });
    mocks.apiGet.mockReset();
    mocks.recoverInFlight.mockClear();
    mocks.dueEntries.mockReset().mockResolvedValue([]);
    mocks.sjmDecrypt.mockReset().mockResolvedValue({ journey_id: '33333333-3333-4333-8333-333333333333', event_type: 'security_check_in', note: null });
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
    expect(mocks.recoverInFlight).toHaveBeenCalledWith({ userId: 'user-1', orgId: 'org-1', allowedOperationTypes: ['sjm.field_event.create'] });
  });

  it('stops after device registration when the originating identity has changed', async () => {
    const isSessionCurrent=vi.fn()
      .mockReturnValueOnce(true)  // before recovery
      .mockReturnValueOnce(true)  // after recovery
      .mockReturnValueOnce(false); // after device registration

    const result=await runSync('user-a','org-a',{
      pullEnabled:false,
      allowedOperationTypes:['sjm.field_event.create'],
      isSessionCurrent,
    });

    expect(result.push).toBeNull();
    expect(result.pull).toBeNull();
    expect(mocks.apiPost.mock.calls.map(call=>call[0])).toEqual(['/sync/device']);
    expect(mocks.reportSyncSuccess).not.toHaveBeenCalled();
  });

  it('abandons a decrypted field batch before sending when the session becomes stale', async () => {
    const sjmEntry={
      id:'11111111-1111-4111-8111-111111111111',
      type:'sjm.field_event.create',
      transport:'sync',
      entityType:'sjm_journey_event',
      entityId:'journey-1',
      label:'Encrypted SJM field report',
      priority:1,
      payload:{__sjm_field_ciphertext:true,version:1,iv:'00112233445566778899aabb',ciphertext:'00'.repeat(40)},
      localSequence:1,
      clientCreatedAt:1_798_000_000_000,
    };
    mocks.dueEntries.mockResolvedValue([sjmEntry]);
    const isSessionCurrent=vi.fn()
      .mockReturnValueOnce(true)  // push entry
      .mockReturnValueOnce(true)  // outbox read complete
      .mockReturnValueOnce(true)  // before decryption
      .mockReturnValueOnce(false); // identity changes during decryption

    const result=await push('user-a','org-a',{
      allowedOperationTypes:['sjm.field_event.create'],
      isSessionCurrent,
    });

    expect(result.attempted).toBe(1);
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(mocks.markSyncing).not.toHaveBeenCalled();
    expect(mocks.markAcknowledged).not.toHaveBeenCalled();
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
      payload: { __sjm_field_ciphertext: true, version: 1, iv: '00112233445566778899aabb', ciphertext: '00'.repeat(40) },
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
      errorClass: 'UNKNOWN',
      status: 'ACKNOWLEDGED',
      retryable: false,
      code: 'accepted',
      message: 'accepted',
    });
    const result = await push('user-1', 'org-1', { allowedOperationTypes: ['sjm.field_event.create'] });
    expect(result).toMatchObject({ attempted: 1, accepted: 1 });
    const pushCall = mocks.apiPost.mock.calls.find(call => call[0] === '/sync/push');
    expect(pushCall?.[1]?.operations).toHaveLength(1);
    expect(pushCall?.[1]?.operations[0]).toMatchObject({ type: 'sjm.field_event.create', entity_id: '33333333-3333-4333-8333-333333333333', payload: { event_type: 'security_check_in', note: null } });
    expect(pushCall?.[1]?.operations.some((entry: {type:string}) => entry.type.startsWith('cds_'))).toBe(false);
    expect(mocks.markAcknowledged).toHaveBeenCalledWith(sjmEntry.id, { event_id: 'event-1' });
  });
});
