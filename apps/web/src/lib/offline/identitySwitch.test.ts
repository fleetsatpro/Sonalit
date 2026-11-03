import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const noop = vi.fn();
  return {
    noop,
    isEnabled: vi.fn(),
    isStorageAvailable: vi.fn(),
    purgeUserData: vi.fn(),
    requestPersistence: vi.fn(),
    storageEstimate: vi.fn(),
    unsyncedCount: vi.fn(),
    quarantinedOfflineCount: vi.fn(),
    db: {
      sync_meta: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      },
    },
    isDegraded: vi.fn(),
    isReachable: vi.fn(),
    startConnectivity: vi.fn(),
    stopConnectivity: vi.fn(),
    subscribeConnectivity: vi.fn(),
    runSync: vi.fn(),
    pruneAcknowledged: vi.fn(),
    pruneEntities: vi.fn(),
  };
});

vi.mock('./capabilities.js', () => ({
  checkEligibility: mocks.noop,
  getSpec: mocks.noop,
}));

vi.mock('./connectivity.js', () => ({
  getSnapshot: mocks.noop,
  isDegraded: mocks.isDegraded,
  isReachable: mocks.isReachable,
  startConnectivity: mocks.startConnectivity,
  stopConnectivity: mocks.stopConnectivity,
  subscribe: mocks.subscribeConnectivity,
  probeNow: mocks.noop,
}));

vi.mock('./db.js', () => ({
  db: mocks.db,
  isStorageAvailable: mocks.isStorageAvailable,
  purgeUserData: mocks.purgeUserData,
  quarantinedOfflineCount: mocks.quarantinedOfflineCount,
  requestPersistence: mocks.requestPersistence,
  storageEstimate: mocks.storageEstimate,
  unsyncedCount: mocks.unsyncedCount,
}));

vi.mock('./device.js', () => ({ getDeviceId: mocks.noop }));
vi.mock('./entities.js', () => ({
  applyLocalChange: mocks.noop,
  findEntityBy: mocks.noop,
  getEntity: mocks.noop,
  listEntities: mocks.noop,
  pruneEntities: mocks.pruneEntities,
}));
vi.mock('./flags.js', () => ({ isEnabled: mocks.isEnabled }));
vi.mock('./gpsBuffer.js', () => ({
  bufferedCount: mocks.noop,
  chooseInterval: mocks.noop,
  flushToOutbox: mocks.noop,
  recordFix: mocks.noop,
}));
vi.mock('./outbox.js', () => ({
  counts: mocks.noop,
  dismissEntry: mocks.noop,
  listForUser: mocks.noop,
  pruneAcknowledged: mocks.pruneAcknowledged,
  recordOperation: mocks.noop,
  retryEntry: mocks.noop,
  subscribeOutbox: mocks.noop,
}));
vi.mock('./qr.js', () => ({
  canActOnScan: mocks.noop,
  decodeScan: mocks.noop,
  resolveScan: mocks.noop,
}));
vi.mock('./syncEngine.js', () => ({
  lastSyncRun: mocks.noop,
  queueDepth: mocks.noop,
  runSync: mocks.runSync,
  SyncBlockedError: class SyncBlockedError extends Error {},
}));

import { startOffline, stopOffline } from './index.js';

const sjmIdentity = {
  userId: 'new-user',
  orgId: 'new-org',
  role: 'dispatcher',
  pullEnabled: false,
  allowedOperationTypes: ['sjm.field_event.create'],
};

describe('offline identity changes preserve unresolved SJM field work', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mocks.isEnabled.mockReturnValue(true);
    mocks.isStorageAvailable.mockResolvedValue(true);
    mocks.isDegraded.mockReturnValue(false);
    mocks.isReachable.mockReturnValue(false);
    mocks.subscribeConnectivity.mockReturnValue(() => undefined);
    mocks.purgeUserData.mockResolvedValue({
      entities: 0, gps: 0, outbox: 0, conflicts: 0, quarantined: 0,
    });
    mocks.db.sync_meta.put.mockResolvedValue(undefined);
    mocks.db.sync_meta.delete.mockResolvedValue(1);
    mocks.runSync.mockResolvedValue({ blocked: null, pull: false, push: false });
  });

  afterEach(async () => {
    await stopOffline({ purge: false });
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('preserves the previous user queue and keys when a different user signs in', async () => {
    mocks.db.sync_meta.get.mockResolvedValue({
      key: 'session:identity',
      value: { userId: 'previous-user', orgId: 'new-org' },
    });

    await expect(startOffline(sjmIdentity)).resolves.toBe(true);

    expect(mocks.purgeUserData).toHaveBeenCalledTimes(1);
    expect(mocks.purgeUserData).toHaveBeenCalledWith('previous-user', {
      keepUnsyncedOutbox: true,
    });
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
    expect(mocks.runSync).toHaveBeenCalledWith(
      'new-user',
      'new-org',
      expect.objectContaining({
        pullEnabled: false,
        allowedOperationTypes: ['sjm.field_event.create'],
      }),
    );
  });

  it('preserves the previous tenant queue and keys when the same user changes organisation', async () => {
    mocks.db.sync_meta.get.mockResolvedValue({
      key: 'session:identity',
      value: { userId: 'new-user', orgId: 'previous-org' },
    });

    await expect(startOffline(sjmIdentity)).resolves.toBe(true);

    expect(mocks.purgeUserData).toHaveBeenCalledTimes(1);
    expect(mocks.purgeUserData).toHaveBeenCalledWith('new-user', {
      keepUnsyncedOutbox: true,
    });
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
    expect(mocks.runSync).toHaveBeenCalledWith(
      'new-user',
      'new-org',
      expect.objectContaining({
        pullEnabled: false,
        allowedOperationTypes: ['sjm.field_event.create'],
      }),
    );
  });

  it('does not purge data when the stored and requested user/tenant scopes match', async () => {
    mocks.db.sync_meta.get.mockResolvedValue({
      key: 'session:identity',
      value: { userId: 'new-user', orgId: 'new-org' },
    });

    await expect(startOffline(sjmIdentity)).resolves.toBe(true);

    expect(mocks.purgeUserData).not.toHaveBeenCalled();
    expect(mocks.runSync).toHaveBeenCalledTimes(1);
    expect(mocks.runSync).toHaveBeenCalledWith(
      'new-user',
      'new-org',
      expect.objectContaining({
        pullEnabled: false,
        allowedOperationTypes: ['sjm.field_event.create'],
      }),
    );
  });

  it('keeps legacy user-only session cleanup non-destructive by relying on the safe default', async () => {
    mocks.db.sync_meta.get.mockResolvedValue({
      key: 'session:identity',
      value: 'previous-user',
    });

    await expect(startOffline(sjmIdentity)).resolves.toBe(true);

    // purgeUserData defaults keepUnsyncedOutbox to true. No destructive false
    // option may be inferred from a legacy identity marker.
    expect(mocks.purgeUserData).toHaveBeenCalledTimes(1);
    expect(mocks.purgeUserData).toHaveBeenCalledWith('previous-user');
    expect(mocks.purgeUserData).not.toHaveBeenCalledWith(
      'previous-user',
      { keepUnsyncedOutbox: false },
    );
  });
});
