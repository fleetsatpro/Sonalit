import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeHeadingDegrees, resolveOperationalDeviceState } from './operationalMapMarkers.js';

const source = readFileSync(new URL('./operationalMapMarkers.ts', import.meta.url), 'utf8');

describe('shared operational map markers', () => {
  it('defines distinct silhouettes for vehicles, field officers and GPS trackers', () => {
    expect(source).toContain("vehicle: '<path");
    expect(source).toContain("guardian: '<path");
    expect(source).toContain("tracker: '<path");
    expect(source).toContain('kind: OperationalMarkerKind');
  });

  it('covers live, stale, offline and high-priority operational states', () => {
    for (const state of ['live:', 'recent:', 'stale:', 'offline:', 'sos:', 'alert:', 'unavailable:']) {
      expect(source).toContain(state);
    }
  });

  it('renders proper identity, detail, heading and accessible labels', () => {
    expect(source).toContain('.sml-device-marker__identity');
    expect(source).toContain('.sml-device-marker__detail');
    expect(source).toContain('--sml-heading');
    expect(source).toContain("button.setAttribute('aria-label', options.ariaLabel?.trim() || button.title)");
    expect(source).toContain("bearing.hidden = !Number.isFinite(heading)");
  });

  it('keeps the GPS anchor at the marker centre and floats labels outside the hit target', () => {
    expect(source).toContain('width:48px;height:48px');
    expect(source).toContain('position:absolute;z-index:4;left:var(--sml-marker-label-left)');
    expect(source).toContain("const markerSize = density === 'overview' ? (selected ? 13 : 10) : density === 'regional' ? (selected ? 20 : 16) : (selected ? 34 : 30)");
    expect(source).toContain('.sml-device-marker__accuracy');
    expect(source).toContain('accuracy / metresPerPixel');
    expect(source).toContain("button.dataset.accuracyVisible = 'true'");
    expect(source).toContain("button.style.setProperty('--sml-marker-label-left'");
  });

  it('adapts label density to map zoom and preserves reduced-motion preferences', () => {
    expect(source).toContain("zoom <= 8 ? 'overview' : zoom < 11.2 ? 'regional' : 'full'");
    expect(source).toContain('@media(prefers-reduced-motion:reduce)');
    expect(source).toContain("data-selected=\"true\"");
  });
});


describe('operational device telemetry semantics', () => {
  const now = Date.parse('2026-11-16T19:00:00.000Z');

  it('distinguishes a fresh Guardian heartbeat from stale or missing GPS', () => {
    expect(resolveOperationalDeviceState({
      kind: 'guardian', status: 'active', lastSeenAt: '2026-11-16T18:59:00.000Z', secondsAgo: 45,
    }, now)).toMatchObject({ state: 'online', heartbeatOnline: true, gpsFixFresh: true });

    expect(resolveOperationalDeviceState({
      kind: 'guardian', status: 'active', lastSeenAt: '2026-11-16T18:59:00.000Z', secondsAgo: 301,
    }, now)).toMatchObject({ state: 'stale', heartbeatOnline: true, gpsFixFresh: false });

    expect(resolveOperationalDeviceState({
      kind: 'guardian', status: 'active', lastSeenAt: '2026-11-16T18:59:00.000Z',
    }, now)).toMatchObject({ state: 'stale', heartbeatOnline: true, gpsFixFresh: false });

    // useLiveFleet derives raw status 'offline' after 30 minutes without a GPS
    // fix. A separate, current Guardian heartbeat must still classify this as
    // stale GPS rather than a lost device heartbeat.
    expect(resolveOperationalDeviceState({
      kind: 'guardian', status: 'offline', lastSeenAt: '2026-11-16T18:59:00.000Z', secondsAgo: 1900,
    }, now)).toMatchObject({ state: 'stale', heartbeatOnline: true, gpsFixFresh: false });
  });

  it('treats invalid, expired and implausibly future heartbeats as offline', () => {
    for (const lastSeenAt of [null, 'not-a-date', '2026-11-16T18:53:00.000Z', '2026-11-16T19:02:00.000Z']) {
      expect(resolveOperationalDeviceState({
        kind: 'guardian', status: 'active', lastSeenAt, secondsAgo: 10,
      }, now).state).toBe('offline');
    }
  });

  it('keeps explicit offline and SOS semantics authoritative', () => {
    expect(resolveOperationalDeviceState({
      kind: 'guardian', status: 'offline', lastSeenAt: '2026-11-16T18:59:00.000Z', secondsAgo: 10,
    }, now).state).toBe('offline');
    expect(resolveOperationalDeviceState({
      kind: 'guardian', status: 'offline', panicActive: true, secondsAgo: 999,
    }, now).state).toBe('sos');
    expect(resolveOperationalDeviceState({ status: 'move' }, now).state).toBe('moving');
    expect(resolveOperationalDeviceState({ status: 'stop' }, now).state).toBe('stopped');
  });

  it('never converts absent or invalid headings into a north-facing bearing', () => {
    expect(normalizeHeadingDegrees(null)).toBeNull();
    expect(normalizeHeadingDegrees(undefined)).toBeNull();
    expect(normalizeHeadingDegrees(Number.NaN)).toBeNull();
    expect(normalizeHeadingDegrees(-1)).toBeNull();
    expect(normalizeHeadingDegrees(361)).toBeNull();
    expect(normalizeHeadingDegrees(360)).toBe(0);
    expect(normalizeHeadingDegrees(87.5)).toBe(87.5);
  });
});
