/**
 * The connectivity state machine.
 *
 * `deriveState` is exported precisely so the decision the whole layer turns on
 * can be verified without a browser, a timer or a network — the alternative is
 * discovering the hysteresis is wrong in a yard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveState, isNetworkDown, isReachable, OFFLINE_AFTER_FAILURES, _reset, setProbe, startConnectivity, stopConnectivity } from './connectivity.js';

const healthy = {
  networkUp: true,
  apiReachable: true,
  consecutiveFailures: 0,
  latencyMs: 120,
  everProbed: true,
};

describe('deriveState', () => {
  it('stays UNKNOWN until something has actually been measured', () => {
    // Claiming ONLINE before the first probe would have the app promise a
    // connection it has never verified.
    expect(deriveState({ ...healthy, everProbed: false })).toBe('UNKNOWN');
  });

  it('is ONLINE when the API answers quickly', () => {
    expect(deriveState(healthy)).toBe('ONLINE');
  });

  it('trusts the OS only in the negative direction', () => {
    // No interface at all is worth believing; "an interface exists" is not.
    expect(deriveState({ ...healthy, networkUp: false })).toBe('OFFLINE');
  });

  it('does not flip to OFFLINE on a single failure', () => {
    // One dropped request is routine on mobile. Flipping the whole app into
    // offline mode over it produces a UI that strobes on a merely mediocre link.
    expect(deriveState({ ...healthy, apiReachable: false, consecutiveFailures: 1 })).toBe('DEGRADED');
  });

  it('goes OFFLINE once failures are consistent', () => {
    expect(
      deriveState({ ...healthy, apiReachable: false, consecutiveFailures: OFFLINE_AFTER_FAILURES }),
    ).toBe('OFFLINE');
  });

  it('reports DEGRADED on a reachable but slow link', () => {
    // The captive-portal / saturated-cell case: requests succeed, eventually.
    // Treating it as ONLINE means sending full-fat payloads over a dying link.
    expect(deriveState({ ...healthy, latencyMs: 5_000 })).toBe('DEGRADED');
  });

  it('stays ONLINE at latency just under the threshold', () => {
    expect(deriveState({ ...healthy, latencyMs: 1_999 })).toBe('ONLINE');
  });

  it('tolerates an unmeasured latency without downgrading', () => {
    expect(deriveState({ ...healthy, latencyMs: null })).toBe('ONLINE');
  });
});

describe('isReachable', () => {
  beforeEach(() => { _reset(); });

  it('is optimistic before the first probe resolves', () => {
    // Regression: isReachable() once excluded UNKNOWN, which made every cold
    // load look offline until a probe returned. The field queue then queued the
    // first action of a shift instead of sending it, and the sync engine
    // declined to run at all.
    //
    // The two errors are not symmetric. Attempting a request while offline just
    // fails and the work is queued; refusing to attempt one while online turns a
    // healthy device into a queue-everything device.
    expect(isReachable()).toBe(true);
  });

  it('treats a weak link as still worth attempting', () => {
    expect(deriveState({ ...healthy, latencyMs: 5_000 })).toBe('DEGRADED');
  });
});

describe('isNetworkDown', () => {
  beforeEach(() => { _reset(); });

  it('does not report the network down merely because nothing has been probed', () => {
    // This drives the full-screen offline takeover. Reporting "down" before any
    // evidence would blank the entire app on every cold load.
    expect(isNetworkDown()).toBe(false);
  });
});


describe('connectivity listener lifecycle', () => {
  afterEach(() => {
    stopConnectivity();
    _reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('removes the exact online/offline/visibility handlers before a restart', () => {
    vi.useFakeTimers();
    _reset();

    const fakeWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const fakeDocument = {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', fakeDocument);
    setProbe(async () => true);

    startConnectivity();
    startConnectivity(); // Idempotent start must not duplicate listeners.
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(2);
    expect(fakeDocument.addEventListener).toHaveBeenCalledTimes(1);

    const addedWindowHandlers = fakeWindow.addEventListener.mock.calls;
    const addedDocumentHandlers = fakeDocument.addEventListener.mock.calls;
    stopConnectivity();

    expect(fakeWindow.removeEventListener.mock.calls).toEqual(addedWindowHandlers);
    expect(fakeDocument.removeEventListener.mock.calls).toEqual(addedDocumentHandlers);

    startConnectivity();
    stopConnectivity();
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(4);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledTimes(4);
    expect(fakeDocument.addEventListener).toHaveBeenCalledTimes(2);
    expect(fakeDocument.removeEventListener).toHaveBeenCalledTimes(2);
  });
});


describe('offline session subscription lifecycle', () => {
  it('detaches the previous reconnect callback on tenant change and removes the active callback on stop', async () => {
    vi.useFakeTimers();
    const reconnectHandlers = new Set<() => void>();
    const unsubscribers: Array<ReturnType<typeof vi.fn>> = [];
    const meta = new Map<string, unknown>();
    const runSync = vi.fn(async () => ({ blocked: null, pull: false, push: false }));
    const subscribeConnectivity = vi.fn((listener: () => void) => {
      reconnectHandlers.add(listener);
      const unsubscribe = vi.fn(() => reconnectHandlers.delete(listener));
      unsubscribers.push(unsubscribe);
      return unsubscribe;
    });

    vi.doMock('./capabilities.js', () => ({
      checkEligibility: () => ({ allowed: true }),
      getSpec: () => null,
    }));
    vi.doMock('./connectivity.js', () => ({
      getSnapshot: () => ({ state: 'ONLINE', networkUp: true, apiReachable: true }),
      isDegraded: () => false,
      isReachable: () => true,
      startConnectivity: vi.fn(),
      stopConnectivity: vi.fn(),
      subscribe: subscribeConnectivity,
      probeNow: vi.fn(async () => true),
    }));
    vi.doMock('./db.js', () => ({
      db: {
        sync_meta: {
          get: vi.fn(async (key: string) => meta.has(key) ? { key, value: meta.get(key) } : undefined),
          put: vi.fn(async (row: { key: string; value: unknown }) => { meta.set(row.key, row.value); }),
          delete: vi.fn(async (key: string) => { meta.delete(key); }),
        },
      },
      isStorageAvailable: vi.fn(async () => true),
      purgeUserData: vi.fn(async () => undefined),
      requestPersistence: vi.fn(async () => true),
      storageEstimate: vi.fn(async () => ({ quota: 1_000_000, usage: 1_000, ratio: 0.001 })),
      unsyncedCount: vi.fn(async () => 0),
    }));
    vi.doMock('./device.js', () => ({ getDeviceId: () => 'test-device' }));
    vi.doMock('./entities.js', () => ({
      applyLocalChange: vi.fn(async () => undefined),
      findEntityBy: vi.fn(async () => null),
      getEntity: vi.fn(async () => null),
      listEntities: vi.fn(async () => []),
      pruneEntities: vi.fn(async () => 0),
    }));
    vi.doMock('./flags.js', () => ({ isEnabled: () => true }));
    vi.doMock('./gpsBuffer.js', () => ({
      bufferedCount: vi.fn(async () => 0),
      chooseInterval: vi.fn(() => 60_000),
      flushToOutbox: vi.fn(async () => 0),
      recordFix: vi.fn(async () => undefined),
    }));
    vi.doMock('./outbox.js', () => ({
      counts: vi.fn(async () => ({ pending: 0, failed: 0, acknowledged: 0 })),
      dismissEntry: vi.fn(async () => undefined),
      listForUser: vi.fn(async () => []),
      pruneAcknowledged: vi.fn(async () => 0),
      recordOperation: vi.fn(async () => ({ id: 'op-1' })),
      retryEntry: vi.fn(async () => undefined),
      subscribeOutbox: vi.fn(() => () => undefined),
    }));
    vi.doMock('./qr.js', () => ({
      canActOnScan: () => true,
      decodeScan: () => null,
      resolveScan: vi.fn(async () => null),
    }));
    vi.doMock('./syncEngine.js', () => ({
      lastSyncRun: () => null,
      queueDepth: vi.fn(async () => 0),
      runSync,
      SyncBlockedError: class SyncBlockedError extends Error { code = 'test-blocked'; },
    }));

    vi.resetModules();
    const { startOffline, stopOffline } = await import('./index.js');
    try {
      expect(await startOffline({ userId: 'user-a', orgId: 'org-a', role: 'admin' })).toBe(true);
      expect(reconnectHandlers.size).toBe(1);

      expect(await startOffline({ userId: 'user-b', orgId: 'org-b', role: 'admin' })).toBe(true);
      expect(unsubscribers[0]).toHaveBeenCalledTimes(1);
      expect(reconnectHandlers.size).toBe(1);

      await stopOffline({ purge: false });
      expect(unsubscribers[1]).toHaveBeenCalledTimes(1);
      expect(reconnectHandlers.size).toBe(0);
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await stopOffline({ purge: false });
      vi.clearAllTimers();
      vi.useRealTimers();
      for (const path of [
        './capabilities.js', './connectivity.js', './db.js', './device.js',
        './entities.js', './flags.js', './gpsBuffer.js', './outbox.js',
        './qr.js', './syncEngine.js',
      ]) vi.doUnmock(path);
      vi.resetModules();
    }
  });
});
