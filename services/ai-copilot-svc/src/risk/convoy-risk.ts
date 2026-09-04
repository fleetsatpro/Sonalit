// Convoy risk scoring (spec §20-22).
//
// A transparent additive model: each factor contributes points, and every
// contribution is recorded with its direction, magnitude and recency. That
// is deliberate over something more sophisticated —
//
//  * it is reproducible from `feature_snapshot` alone (§26),
//  * it is explainable by construction, so §22's "strongest contributing
//    factors, direction, recency" falls out rather than needing a separate
//    attribution step, and
//  * it needs no training data, which the platform does not yet have.
//
// The honest limitation: the weights are engineering judgement, not fitted
// to outcomes. So the score is an ORDERING — useful for "which convoy
// needs attention first" — and `calibration_status` is 'uncalibrated',
// which keeps `probability` null. Turning it into a real probability means
// back-testing against historical incidents, and until then quoting a
// percentage would be a fabricated statistic (§21, Rule 4).

import { randomUUID } from 'node:crypto';

import type { CalibrationStatus, Prediction, RiskFactor } from './types.js';
import type { Signal } from '../watchtower/types.js';

export const CONVOY_RISK_MODEL_VERSION = 'convoy-risk-heuristic-v1';

/**
 * Points per signal type. Ordered by how strongly each indicates that a
 * convoy is in trouble rather than merely behind schedule.
 */
const SIGNAL_WEIGHTS: Record<string, number> = {
  // Weighted so that a single critical panic (50 x 1.5) clears the
  // 'critical' band on its own. A panic press is the strongest distress
  // indicator the platform has, and an operator triaging by band must
  // never see one ranked below the top — corroboration should not be
  // required before it is treated as urgent.
  panic: 50,
  seal_broken: 30,
  corridor_deviation: 20,
  convoy_separation: 18,
  comms_silence: 15,
  unexpected_stop: 12,
  telemetry_gap: 12,
  geofence_breach: 10,
  eta_degradation: 8,
  speed_violation: 5,
};

const SEVERITY_MULTIPLIER: Record<string, number> = {
  info: 0.5,
  warning: 1,
  critical: 1.5,
};

/**
 * Signals decay: a deviation 40 minutes ago says less about now than one
 * two minutes ago. Half-life rather than a cliff, so a score does not jump
 * when a signal crosses an arbitrary boundary.
 */
const HALF_LIFE_MINUTES = 30;

function recencyWeight(ageMinutes: number): number {
  if (ageMinutes <= 0) return 1;
  return 0.5 ** (ageMinutes / HALF_LIFE_MINUTES);
}

function band(value: number): Prediction['band'] {
  if (value >= 70) return 'critical';
  if (value >= 40) return 'high';
  if (value >= 20) return 'medium';
  return 'low';
}

export interface ConvoyRiskInput {
  org_id: string;
  convoy_id: string;
  /** Signals for this convoy, recent first or otherwise — order is ignored. */
  signals: Signal[];
  /** Minutes the convoy is behind its planned arrival, when known. */
  eta_delay_minutes?: number | null;
  /** Known risk zones the planned route passes through. */
  route_risk_zones?: { name: string; risk_level: string }[];
  /** Injected so scoring is deterministic under test. */
  now?: Date;
}

const ZONE_WEIGHTS: Record<string, number> = {
  low: 2,
  medium: 5,
  high: 10,
  critical: 15,
  no_go: 25,
};

/**
 * Scores a convoy's operational risk.
 *
 * Returns a Prediction even when there are no signals at all: a score of
 * zero with an explicit "no signals" warning is a meaningful, honest
 * answer, whereas returning nothing would leave a caller unable to
 * distinguish "quiet" from "we did not look".
 */
export function scoreConvoyRisk(input: ConvoyRiskInput): Prediction {
  const now = input.now ?? new Date();
  const factors: RiskFactor[] = [];
  const warnings: string[] = [];
  let score = 0;

  // Only the strongest occurrence of each signal type counts. Ten GPS-gap
  // events from one flapping device is one problem, not ten, and summing
  // them would let a noisy sensor dominate the score.
  const strongestByType = new Map<string, { signal: Signal; points: number; ageMin: number }>();

  for (const signal of input.signals) {
    const base = SIGNAL_WEIGHTS[signal.type];
    if (base === undefined) continue;

    const ageMin = (now.getTime() - signal.observed_at.getTime()) / 60_000;
    const points = base * (SEVERITY_MULTIPLIER[signal.severity] ?? 1) * recencyWeight(ageMin);

    const existing = strongestByType.get(signal.type);
    if (!existing || points > existing.points) {
      strongestByType.set(signal.type, { signal, points, ageMin });
    }
  }

  for (const { signal, points, ageMin } of strongestByType.values()) {
    const rounded = Math.round(points * 10) / 10;
    score += rounded;
    factors.push({
      name: signal.type,
      value: signal.severity,
      contribution: rounded,
      direction: 'increases',
      observed_seconds_ago: Math.round(ageMin * 60),
      explanation:
        `${signal.type.replace(/_/g, ' ')} (${signal.severity}) observed ` +
        `${String(Math.round(ageMin))} minutes ago`,
    });
  }

  const delay = input.eta_delay_minutes;
  if (delay !== null && delay !== undefined && delay > 0) {
    // Capped: a convoy six hours late is in trouble, but not proportionally
    // more so than one three hours late — the signal saturates.
    const contribution = Math.min(Math.round(delay / 3), 15);
    if (contribution > 0) {
      score += contribution;
      factors.push({
        name: 'eta_delay',
        value: delay,
        contribution,
        direction: 'increases',
        observed_seconds_ago: 0,
        explanation: `Running ${String(delay)} minutes behind planned arrival`,
      });
    }
  }

  for (const zone of input.route_risk_zones ?? []) {
    const contribution = ZONE_WEIGHTS[zone.risk_level] ?? 0;
    if (contribution === 0) continue;
    score += contribution;
    factors.push({
      name: 'route_risk_zone',
      value: zone.name,
      contribution,
      direction: 'increases',
      observed_seconds_ago: null,
      explanation: `Planned route passes through ${zone.name} (${zone.risk_level} risk)`,
    });
  }

  // Freshness of the newest input. A score built only from old telemetry
  // is a statement about the past, and must be labelled as one (§48).
  const ages = input.signals.map((s) => (now.getTime() - s.observed_at.getTime()) / 1000);
  const dataAgeSeconds = ages.length > 0 ? Math.round(Math.min(...ages)) : null;

  if (input.signals.length === 0) {
    warnings.push(
      'No signals available for this convoy. A score of zero means nothing was ' +
        'observed, not that the convoy is confirmed safe.',
    );
  } else if (dataAgeSeconds !== null && dataAgeSeconds > 30 * 60) {
    warnings.push(
      `Newest signal is ${String(Math.round(dataAgeSeconds / 60))} minutes old; this ` +
        'assessment describes the past, not the current situation.',
    );
  }
  if (delay === null || delay === undefined) {
    warnings.push('ETA data unavailable, so schedule risk is not represented in this score.');
  }

  const value = Math.min(100, Math.round(score));
  // Strongest first — §22 asks for the strongest contributing factors.
  factors.sort((a, b) => b.contribution - a.contribution);

  const calibration: CalibrationStatus = 'uncalibrated';

  return {
    prediction_id: randomUUID(),
    org_id: input.org_id,
    entity_type: 'convoy',
    entity_id: input.convoy_id,
    prediction_type: 'convoy_risk',
    value,
    band: band(value),
    // §21: the weights are engineering judgement, not fitted to outcomes,
    // so there is no honest probability to report.
    probability: null,
    horizon_minutes: 60,
    generated_at: now,
    model_version: CONVOY_RISK_MODEL_VERSION,
    feature_snapshot: {
      signal_count: input.signals.length,
      distinct_signal_types: strongestByType.size,
      eta_delay_minutes: delay ?? null,
      route_risk_zone_count: input.route_risk_zones?.length ?? 0,
      newest_signal_age_seconds: dataAgeSeconds,
    },
    contributing_signals: factors,
    calibration_status: calibration,
    data_age_seconds: dataAgeSeconds,
    warnings,
  };
}
