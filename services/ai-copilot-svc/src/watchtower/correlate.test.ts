import { describe, it, expect } from 'vitest';

import { correlate, DEFAULT_RULES, type CorrelationRule } from './correlate.js';
import { isValidTransition, maxSeverity, type Signal, type SignalType } from './types.js';

const ORG = '00000000-0000-4000-8000-00000000000a';
const T0 = new Date('2026-09-04T10:00:00Z');

let counter = 0;
function signal(type: SignalType, offsetMinutes = 0, overrides: Partial<Signal> = {}): Signal {
  counter += 1;
  const observed = new Date(T0.getTime() + offsetMinutes * 60_000);
  return {
    signal_id: `sig-${String(counter)}`,
    org_id: ORG,
    type,
    severity: 'warning',
    entity_type: 'convoy',
    entity_id: 'convoy-17',
    convoy_id: 'convoy-17',
    observed_at: observed,
    ingested_at: observed,
    payload: {},
    source: 'test',
    ...overrides,
  };
}

describe('correlate', () => {
  // §64's worked example: four events, one situation.
  it('folds a deviation, stop, ETA slip and silence into one finding', () => {
    const signals = [
      signal('corridor_deviation', 0),
      signal('unexpected_stop', 3),
      signal('eta_degradation', 6),
      signal('comms_silence', 9),
    ];

    const { correlations, uncorrelated } = correlate(signals, { now: T0 });

    expect(correlations).toHaveLength(1);
    expect(correlations[0]?.finding).toBe('POSSIBLE OPERATIONAL DISRUPTION');
    expect(uncorrelated).toEqual([]);
  });

  // §30 — "Never destroy evidence when aggregating."
  it('carries every contributing signal unmodified as evidence', () => {
    const signals = [signal('corridor_deviation', 0), signal('unexpected_stop', 2)];

    const [correlation] = correlate(signals, { now: T0 }).correlations;

    expect(correlation?.signals).toHaveLength(2);
    expect(correlation?.signals).toEqual(expect.arrayContaining(signals));
    expect(correlation?.window_start).toEqual(T0);
    expect(correlation?.window_end).toEqual(new Date(T0.getTime() + 2 * 60_000));
  });

  // A rule that fires must be reproducible from what it recorded (§26).
  it('records which rule produced the finding', () => {
    const [correlation] = correlate(
      [signal('corridor_deviation', 0), signal('unexpected_stop', 1)],
      { now: T0 },
    ).correlations;

    expect(correlation?.rule_id).toBe('operational_disruption_v1');
    expect(correlation?.state).toBe('correlated');
  });

  it('does not correlate signals outside the rule window', () => {
    const signals = [
      signal('corridor_deviation', 0),
      signal('unexpected_stop', 90), // well past the 20-minute window
    ];

    const { correlations, uncorrelated } = correlate(signals, { now: T0 });

    expect(correlations).toHaveLength(0);
    expect(uncorrelated).toHaveLength(2);
  });

  // Correlation reduces noise; it must never swallow a signal outright.
  it('returns unmatched signals rather than dropping them', () => {
    const lone = signal('speed_violation', 0);

    const { correlations, uncorrelated } = correlate([lone], { now: T0 });

    expect(correlations).toHaveLength(0);
    expect(uncorrelated).toEqual([lone]);
  });

  it('does not correlate across different convoys', () => {
    const signals = [
      signal('corridor_deviation', 0, { convoy_id: 'convoy-17', entity_id: 'convoy-17' }),
      signal('unexpected_stop', 2, { convoy_id: 'convoy-99', entity_id: 'convoy-99' }),
    ];

    const { correlations, uncorrelated } = correlate(signals, { now: T0 });

    expect(correlations).toHaveLength(0);
    expect(uncorrelated).toHaveLength(2);
  });

  it('escalates severity when corroborating signals are present', () => {
    const core = [signal('corridor_deviation', 0), signal('unexpected_stop', 1)];
    const withBoost = [...core.map((s) => ({ ...s })), signal('comms_silence', 2)];

    const plain = correlate(core, { now: T0 }).correlations[0];
    const boosted = correlate(withBoost, { now: T0 }).correlations[0];

    expect(plain?.severity).toBe('warning');
    expect(boosted?.severity).toBe('critical');
  });

  it('never reports below the severity of its worst member signal', () => {
    const signals = [
      signal('comms_silence', 0, { severity: 'critical' }),
      signal('telemetry_gap', 1, { severity: 'info' }),
    ];

    const [correlation] = correlate(signals, { now: T0 }).correlations;

    expect(correlation?.severity).toBe('critical');
  });

  it('treats panic with loss of contact as critical distress', () => {
    const signals = [signal('panic', 0, { severity: 'critical' }), signal('comms_silence', 1)];

    const [correlation] = correlate(signals, { now: T0 }).correlations;

    expect(correlation?.finding).toContain('DISTRESS');
    expect(correlation?.severity).toBe('critical');
  });

  // A signal that merely fell inside the window would be misleading as
  // evidence for this finding, so only named types are taken.
  it('excludes unrelated signals that merely fall inside the window', () => {
    const signals = [
      signal('corridor_deviation', 0),
      signal('unexpected_stop', 1),
      signal('speed_violation', 2),
    ];

    const { correlations, uncorrelated } = correlate(signals, { now: T0 });

    expect(correlations[0]?.signals.map((s) => s.type)).not.toContain('speed_violation');
    expect(uncorrelated.map((s) => s.type)).toEqual(['speed_violation']);
  });

  it('does not reuse a signal across two findings', () => {
    const signals = [
      signal('corridor_deviation', 0),
      signal('unexpected_stop', 1),
      signal('seal_broken', 2),
    ];

    const { correlations } = correlate(signals, { now: T0 });
    const used = correlations.flatMap((c) => c.signals.map((s) => s.signal_id));

    expect(new Set(used).size).toBe(used.length);
  });

  it('is deterministic for the same input', () => {
    const build = (): Signal[] => {
      counter = 0;
      return [signal('corridor_deviation', 0), signal('unexpected_stop', 2)];
    };

    const first = correlate(build(), { now: T0 }).correlations;
    const second = correlate(build(), { now: T0 }).correlations;

    expect(first[0]?.rule_id).toBe(second[0]?.rule_id);
    expect(first[0]?.finding).toBe(second[0]?.finding);
    expect(first[0]?.signals.map((s) => s.signal_id)).toEqual(
      second[0]?.signals.map((s) => s.signal_id),
    );
  });

  it('accepts custom rules in place of the defaults', () => {
    const rule: CorrelationRule = {
      rule_id: 'custom_v1',
      finding: 'CUSTOM FINDING',
      requires: ['speed_violation'],
      window_ms: 60_000,
      base_severity: 'info',
    };

    const { correlations } = correlate([signal('speed_violation', 0)], {
      rules: [rule],
      now: T0,
    });

    expect(correlations[0]?.finding).toBe('CUSTOM FINDING');
  });

  it('ships rules with unique ids', () => {
    const ids = DEFAULT_RULES.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('lifecycle', () => {
  // A late-arriving event must not reopen a resolved situation.
  it('permits forward transitions only', () => {
    expect(isValidTransition('detected', 'correlated')).toBe(true);
    expect(isValidTransition('notified', 'verified')).toBe(true);
    expect(isValidTransition('resolved', 'detected')).toBe(false);
    expect(isValidTransition('assessed', 'assessed')).toBe(false);
  });
});

describe('maxSeverity', () => {
  it('returns the worst severity present', () => {
    expect(maxSeverity(['info', 'critical', 'warning'])).toBe('critical');
    expect(maxSeverity(['info'])).toBe('info');
    expect(maxSeverity([])).toBe('info');
  });
});
