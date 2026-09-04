// Watchtower — types (spec §28-31).
//
// Watchtower is the continuously running intelligence service. Its pipeline
// is deterministic up to the point of interpretation:
//
//   EVENT -> NORMALIZE -> RULE EVAL -> ANOMALY -> CORRELATE -> RISK
//         -> AI INTERPRETATION -> POLICY -> NOTIFY/ACT -> VERIFY
//
// Everything in this module sits BEFORE "AI interpretation" on purpose. If
// every model is unavailable, correlation and risk still run and operators
// still get alerts — the AI layer explains findings, it does not produce
// them (§20, Rule 3).

import { z } from 'zod';

/**
 * The signal vocabulary. Watchtower normalises every source — NATS
 * subjects, BullMQ jobs, alert rows — into one of these, so correlation
 * reasons over signals rather than over the shape of each producer.
 */
export const SignalType = z.enum([
  'corridor_deviation',
  'unexpected_stop',
  'eta_degradation',
  'comms_silence',
  'geofence_breach',
  'speed_violation',
  'panic',
  'seal_broken',
  'convoy_separation',
  'telemetry_gap',
]);
export type SignalType = z.infer<typeof SignalType>;

/** Matches AlertSeveritySchema in @sonalit/contracts. */
export const Severity = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof Severity>;

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export function maxSeverity(severities: Severity[]): Severity {
  return severities.reduce<Severity>(
    (worst, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[worst] ? s : worst),
    'info',
  );
}

/** What a signal is about. Correlation groups by entity. */
export const EntityType = z.enum(['vehicle', 'convoy', 'driver', 'device', 'container']);
export type EntityType = z.infer<typeof EntityType>;

/**
 * A normalised signal.
 *
 * `observed_at` is when the world produced it; `ingested_at` is when
 * Watchtower saw it. Both are kept because the gap between them IS the
 * freshness signal §48 requires — a fix that arrives 40 minutes late is
 * not evidence of what is happening now.
 */
export const Signal = z.object({
  signal_id: z.string(),
  org_id: z.string(),
  type: SignalType,
  severity: Severity,
  entity_type: EntityType,
  entity_id: z.string(),
  /** Convoy this entity belonged to, when known. Widens correlation scope. */
  convoy_id: z.string().nullable().default(null),
  observed_at: z.date(),
  ingested_at: z.date(),
  /** Producer-specific detail, retained verbatim as evidence (§30). */
  payload: z.record(z.unknown()).default({}),
  source: z.string(),
});
export type Signal = z.infer<typeof Signal>;

/**
 * Lifecycle states (§31). Ordered — a correlation only moves forward.
 *
 * `verified` is distinct from `resolved` on purpose: §63 ends with
 * "verification determines whether the intervention worked", so closing an
 * incident and confirming the situation actually recovered are different
 * facts and are recorded as such.
 */
export const CorrelationState = z.enum([
  'detected',
  'correlated',
  'assessed',
  'notified',
  'acknowledged',
  'actioned',
  'resolved',
  'verified',
]);
export type CorrelationState = z.infer<typeof CorrelationState>;

const STATE_ORDER: CorrelationState[] = [
  'detected',
  'correlated',
  'assessed',
  'notified',
  'acknowledged',
  'actioned',
  'resolved',
  'verified',
];

/** True when `to` is a forward move. Prevents a late event reopening a resolution. */
export function isValidTransition(from: CorrelationState, to: CorrelationState): boolean {
  return STATE_ORDER.indexOf(to) > STATE_ORDER.indexOf(from);
}

/**
 * A correlated finding: several signals that together mean more than they
 * do apart (§30).
 *
 * `signals` holds every contributing signal, unmodified. Aggregation must
 * never destroy evidence — an operator has to be able to see the four raw
 * events behind "possible operational disruption" and disagree with the
 * conclusion.
 */
export interface Correlation {
  correlation_id: string;
  org_id: string;
  entity_type: EntityType;
  entity_id: string;
  convoy_id: string | null;
  /** Deterministic label from the rule that fired. Not model-generated. */
  finding: string;
  severity: Severity;
  state: CorrelationState;
  signals: Signal[];
  window_start: Date;
  window_end: Date;
  /** Which correlation rule produced this, for reproducibility (§26). */
  rule_id: string;
  created_at: Date;
}
