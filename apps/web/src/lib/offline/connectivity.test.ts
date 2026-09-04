/**
 * The connectivity state machine.
 *
 * `deriveState` is exported precisely so the decision the whole layer turns on
 * can be verified without a browser, a timer or a network — the alternative is
 * discovering the hysteresis is wrong in a yard.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { deriveState, isNetworkDown, isReachable, OFFLINE_AFTER_FAILURES, _reset } from './connectivity.js';

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
