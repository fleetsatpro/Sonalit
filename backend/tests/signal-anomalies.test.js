'use strict';

const { classifySignal, bySeverity } = require('../src/services/signal/anomalies');

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const ago = min => new Date(NOW - min * 60000).toISOString();

describe('classifySignal', () => {
  test('healthy: seen and fixed recently', () => {
    const v = classifySignal({ last_seen: ago(1), last_fix_at: ago(1) }, NOW);
    expect(v.state).toBe('ok');
    expect(v.severity).toBe('low');
  });

  test('gps_frozen: heartbeating but GPS stale (jamming signature)', () => {
    const v = classifySignal({ last_seen: ago(1), last_fix_at: ago(20) }, NOW);
    expect(v.state).toBe('gps_frozen');
    expect(v.severity).toBe('high');
    expect(v.reasons[0]).toMatch(/jamming/i);
  });

  test('comms_blackout: no contact at all past threshold', () => {
    const v = classifySignal({ last_seen: ago(30), last_fix_at: ago(30) }, NOW);
    expect(v.state).toBe('comms_blackout');
  });

  test('comms_blackout outranks gps staleness when both are old', () => {
    const v = classifySignal({ last_seen: ago(30), last_fix_at: ago(60) }, NOW);
    expect(v.state).toBe('comms_blackout');
  });

  test('active convoy escalates severity to critical', () => {
    const v = classifySignal({ last_seen: ago(1), last_fix_at: ago(20), on_active_convoy: true }, NOW);
    expect(v.state).toBe('gps_frozen');
    expect(v.severity).toBe('critical');
  });

  test('never-seen device is no_data, not a blackout', () => {
    const v = classifySignal({ last_seen: null, last_fix_at: null }, NOW);
    expect(v.state).toBe('no_data');
  });

  test('missing fix while freshly seen reads as GPS frozen', () => {
    const v = classifySignal({ last_seen: ago(1), last_fix_at: null }, NOW);
    expect(v.state).toBe('gps_frozen');
    expect(v.fix_age_ms).toBeNull();
  });

  test('respects custom thresholds', () => {
    const v = classifySignal({ last_seen: ago(2), last_fix_at: ago(2) }, NOW, { commsBlackoutMs: 60000 });
    expect(v.state).toBe('comms_blackout');
  });
});

describe('bySeverity ordering', () => {
  test('sorts blackout before frozen before ok', () => {
    const items = [
      { state: 'ok', seen_age_ms: 1000 },
      { state: 'comms_blackout', seen_age_ms: 5000 },
      { state: 'gps_frozen', seen_age_ms: 2000 },
    ];
    expect(items.slice().sort(bySeverity).map(i => i.state))
      .toEqual(['comms_blackout', 'gps_frozen', 'ok']);
  });
});
