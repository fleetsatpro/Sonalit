import { describe, it, expect } from 'vitest';

import { scoreConvoyRisk, CONVOY_RISK_MODEL_VERSION } from './convoy-risk.js';

import type { Signal, SignalType } from '../watchtower/types.js';

const ORG = '00000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-09-04T12:00:00Z');

let n = 0;
function signal(
  type: SignalType,
  agoMinutes = 0,
  severity: Signal['severity'] = 'warning',
): Signal {
  n += 1;
  return {
    signal_id: `s-${String(n)}`,
    org_id: ORG,
    type,
    severity,
    entity_type: 'convoy',
    entity_id: 'convoy-17',
    convoy_id: 'convoy-17',
    observed_at: new Date(NOW.getTime() - agoMinutes * 60_000),
    ingested_at: NOW,
    payload: {},
    source: 'test',
  };
}

const base = { org_id: ORG, convoy_id: 'convoy-17', now: NOW };

describe('scoreConvoyRisk', () => {
  it('scores a quiet convoy at zero and says why', () => {
    const p = scoreConvoyRisk({ ...base, signals: [] });

    expect(p.value).toBe(0);
    expect(p.band).toBe('low');
    // Rule 4 — absence of signal is not evidence of safety.
    expect(p.warnings.join(' ')).toContain('not that the convoy is confirmed safe');
  });

  it('raises the score for severe signals', () => {
    const quiet = scoreConvoyRisk({ ...base, signals: [signal('speed_violation')] });
    const bad = scoreConvoyRisk({ ...base, signals: [signal('panic', 0, 'critical')] });

    expect(bad.value).toBeGreaterThan(quiet.value);
    expect(bad.band).toBe('critical');
  });

  // §22 — an explanation must name the strongest factors, their direction
  // and their recency.
  it('explains every contribution, strongest first', () => {
    const p = scoreConvoyRisk({
      ...base,
      signals: [signal('speed_violation', 1), signal('panic', 1, 'critical')],
    });

    expect(p.contributing_signals[0]?.name).toBe('panic');
    for (const factor of p.contributing_signals) {
      expect(factor.direction).toBe('increases');
      expect(factor.contribution).toBeGreaterThan(0);
      expect(factor.explanation.length).toBeGreaterThan(10);
      expect(factor.observed_seconds_ago).not.toBeNull();
    }
  });

  // A stale signal says less about now than a fresh one.
  it('decays older signals', () => {
    const fresh = scoreConvoyRisk({ ...base, signals: [signal('corridor_deviation', 0)] });
    const old = scoreConvoyRisk({ ...base, signals: [signal('corridor_deviation', 60)] });

    expect(old.value).toBeLessThan(fresh.value);
    expect(old.value).toBeGreaterThan(0);
  });

  // One flapping device is one problem, not ten.
  it('counts only the strongest occurrence of each signal type', () => {
    const once = scoreConvoyRisk({ ...base, signals: [signal('telemetry_gap', 0)] });
    const tenTimes = scoreConvoyRisk({
      ...base,
      signals: Array.from({ length: 10 }, () => signal('telemetry_gap', 0)),
    });

    expect(tenTimes.value).toBe(once.value);
  });

  it('adds schedule and route-zone risk', () => {
    const plain = scoreConvoyRisk({ ...base, signals: [], eta_delay_minutes: 0 });
    const delayed = scoreConvoyRisk({ ...base, signals: [], eta_delay_minutes: 30 });
    const throughZone = scoreConvoyRisk({
      ...base,
      signals: [],
      eta_delay_minutes: 0,
      route_risk_zones: [{ name: 'Garissa Corridor', risk_level: 'critical' }],
    });

    expect(delayed.value).toBeGreaterThan(plain.value);
    expect(throughZone.value).toBeGreaterThan(plain.value);
    expect(throughZone.contributing_signals[0]?.value).toBe('Garissa Corridor');
  });

  it('saturates the delay contribution rather than scaling without limit', () => {
    const late = scoreConvoyRisk({ ...base, signals: [], eta_delay_minutes: 60 });
    const veryLate = scoreConvoyRisk({ ...base, signals: [], eta_delay_minutes: 600 });

    expect(veryLate.value - late.value).toBeLessThanOrEqual(5);
  });

  // §21 — the weights are judgement, not fitted to outcomes, so quoting a
  // percentage would be a fabricated statistic.
  it('reports no probability while the model is uncalibrated', () => {
    const p = scoreConvoyRisk({ ...base, signals: [signal('panic', 0, 'critical')] });

    expect(p.calibration_status).toBe('uncalibrated');
    expect(p.probability).toBeNull();
  });

  // §48 — a score built from old telemetry describes the past.
  it('flags an assessment built only from stale signals', () => {
    const p = scoreConvoyRisk({ ...base, signals: [signal('corridor_deviation', 90)] });

    expect(p.data_age_seconds).toBe(90 * 60);
    expect(p.warnings.join(' ')).toContain('describes the past');
  });

  it('says when ETA data was unavailable rather than scoring as if on time', () => {
    const p = scoreConvoyRisk({ ...base, signals: [signal('panic')] });
    expect(p.warnings.join(' ')).toContain('ETA data unavailable');
  });

  // §26 / §21 — reproducible from what it recorded.
  it('records a feature snapshot and model version', () => {
    const p = scoreConvoyRisk({
      ...base,
      signals: [signal('panic', 2, 'critical'), signal('comms_silence', 5)],
      eta_delay_minutes: 12,
    });

    expect(p.model_version).toBe(CONVOY_RISK_MODEL_VERSION);
    expect(p.feature_snapshot).toMatchObject({
      signal_count: 2,
      distinct_signal_types: 2,
      eta_delay_minutes: 12,
    });
    expect(p.prediction_type).toBe('convoy_risk');
    expect(p.horizon_minutes).toBeGreaterThan(0);
  });

  it('never exceeds the scale ceiling', () => {
    const everything = (
      [
        'panic',
        'seal_broken',
        'corridor_deviation',
        'convoy_separation',
        'comms_silence',
        'unexpected_stop',
        'telemetry_gap',
        'geofence_breach',
      ] as SignalType[]
    ).map((t) => signal(t, 0, 'critical'));

    const p = scoreConvoyRisk({
      ...base,
      signals: everything,
      eta_delay_minutes: 600,
      route_risk_zones: [{ name: 'Z', risk_level: 'no_go' }],
    });

    expect(p.value).toBe(100);
    expect(p.band).toBe('critical');
  });

  it('is deterministic for identical input', () => {
    const build = (): Signal[] => {
      n = 0;
      return [signal('panic', 3, 'critical')];
    };
    const a = scoreConvoyRisk({ ...base, signals: build() });
    const b = scoreConvoyRisk({ ...base, signals: build() });

    expect(a.value).toBe(b.value);
    expect(a.contributing_signals).toEqual(b.contributing_signals);
  });
});
