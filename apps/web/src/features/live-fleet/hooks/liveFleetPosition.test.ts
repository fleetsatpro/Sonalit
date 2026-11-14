import { describe, expect, it } from 'vitest';
import {
  indexLatestGpsPositions,
  isRecentDeviceHeartbeat,
  isValidGpsPosition,
  mergeGpsSnapshotWithRealtime,
  preferNewerGpsPosition,
  secondsSinceGpsFix,
  type LiveGpsPosition,
} from './liveFleetPosition.js';

const fix = (overrides: Partial<LiveGpsPosition> = {}): LiveGpsPosition => ({
  device_id: 'guardian-1',
  vehicle_id: null,
  lat: -1.28,
  lng: 36.82,
  timestamp: '2026-11-14T06:00:00.000Z',
  ...overrides,
});

describe('Live Fleet GPS position integrity', () => {
  it('chooses the newest device fix irrespective of API row ordering', () => {
    const older = fix({ timestamp: '2026-11-14T05:58:00.000Z', lat: -1.3 });
    const newer = fix({ timestamp: '2026-11-14T06:00:00.000Z', lat: -1.2 });
    expect(indexLatestGpsPositions([newer, older]).get('guardian-1')?.lat).toBe(-1.2);
    expect(indexLatestGpsPositions([older, newer]).get('guardian-1')?.lat).toBe(-1.2);
  });

  it('prefers the more accurate fix when device timestamps tie', () => {
    const broad = fix({ accuracy_m: 80 });
    const precise = fix({ accuracy_m: 7 });
    expect(preferNewerGpsPosition(broad, precise).accuracy_m).toBe(7);
  });

  it('rejects invalid WGS84 coordinates and does not coerce missing coordinates to zero', () => {
    expect(isValidGpsPosition(fix({ lat: 91 }))).toBe(false);
    expect(isValidGpsPosition(fix({ lng: -181 }))).toBe(false);
    expect(isValidGpsPosition({ device_id: 'missing', vehicle_id: null } )).toBe(false);
    expect(indexLatestGpsPositions([fix({ lat: 91 })])).toHaveLength?.(0);
  });

  it('does not let a stale HTTP snapshot replace a websocket update received after the request began', () => {
    const requestStartedAt = 1_000;
    const snapshot = new Map([['guardian-1', fix({ timestamp: '2026-11-14T06:00:10.000Z', lat: -1.2 })]]);
    const realtime = fix({ timestamp: '2026-11-14T06:00:15.000Z', lat: -1.1, _receivedAt: 1_500 });
    const previous = new Map([['guardian-1', realtime]]);
    expect(mergeGpsSnapshotWithRealtime(snapshot, previous, requestStartedAt).get('guardian-1')?.lat).toBe(-1.1);
  });

  it('treats future-dated or missing fix times as unavailable rather than live', () => {
    expect(secondsSinceGpsFix(null, Date.parse('2026-11-14T06:00:00.000Z'))).toBe(Number.POSITIVE_INFINITY);
    expect(secondsSinceGpsFix('2026-11-14T06:02:00.000Z', Date.parse('2026-11-14T06:00:00.000Z'))).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps heartbeat freshness separate from GPS fix age', () => {
    const now = Date.parse('2026-11-14T06:00:00.000Z');
    expect(isRecentDeviceHeartbeat('2026-11-14T05:59:00.000Z', now)).toBe(true);
    expect(secondsSinceGpsFix('2026-11-14T05:00:00.000Z', now)).toBe(3600);
    expect(isRecentDeviceHeartbeat('2026-11-14T05:50:00.000Z', now)).toBe(false);
  });
});
