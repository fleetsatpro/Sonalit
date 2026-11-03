/**
 * Adaptive sampling decides whether a driver's phone survives a shift, so the
 * policy is a pure function and is tested as one.
 */
import { describe, expect, it } from 'vitest';

import { chooseInterval, SAMPLE_INTERVAL } from './gpsBuffer.js';

const active = { operationallyActive: true, charging: false, batteryLevel: 0.8 };

describe('chooseInterval', () => {
  it('samples fastest at road speed, where a coarse track loses corners', () => {
    expect(chooseInterval({ ...active, speed: 25 })).toBe(SAMPLE_INTERVAL.FAST);
  });

  it('samples moderately in yard manoeuvring', () => {
    expect(chooseInterval({ ...active, speed: 4 })).toBe(SAMPLE_INTERVAL.SLOW);
  });

  it('backs off when stationary — a parked truck needs proof, not a stream', () => {
    expect(chooseInterval({ ...active, speed: 0.2 })).toBe(SAMPLE_INTERVAL.STATIONARY);
  });

  it('backs right off on low battery', () => {
    // A phone that dies at 14:00 tracks nothing at all after 14:00, so battery
    // beats fidelity — but tracking continues rather than stopping.
    expect(chooseInterval({ ...active, speed: 25, batteryLevel: 0.1 }))
      .toBe(SAMPLE_INTERVAL.LOW_BATTERY);
  });

  it('ignores the battery penalty while charging', () => {
    expect(chooseInterval({ ...active, speed: 25, batteryLevel: 0.1, charging: true }))
      .toBe(SAMPLE_INTERVAL.FAST);
  });

  it('idles outside an active operation regardless of speed', () => {
    expect(chooseInterval({ ...active, operationallyActive: false, speed: 25 }))
      .toBe(SAMPLE_INTERVAL.STATIONARY);
  });

  it('falls back to the middle rate when speed is unknown', () => {
    // A first fix has no speed. Assuming stationary would miss a departure;
    // assuming fast would burn battery on a parked vehicle.
    expect(chooseInterval({ ...active, speed: null })).toBe(SAMPLE_INTERVAL.SLOW);
  });
});
