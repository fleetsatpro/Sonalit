/**
 * The connectivity state machine.
 *
 * `deriveState` is exported precisely so the decision the whole layer turns on
 * can be verified without a browser, a timer or a network — the alternative is
 * discovering the hysteresis is wrong in a yard.
 */
import { describe, expect, it } from 'vitest';

import { deriveState, OFFLINE_AFTER_FAILURES } from './connectivity.js';

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
